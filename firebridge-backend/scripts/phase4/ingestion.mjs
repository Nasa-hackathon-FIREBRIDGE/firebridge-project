import { Buffer } from 'node:buffer';
import {
  actor,
  areaInput,
  endDate,
  fixtureDetections,
  fixtureKey,
  ids,
  instant,
  sha256,
  sourceInput
} from './fixture.mjs';

const definitions = Object.freeze({
  assets: {
    keys: ['id'],
    columns:
      'id source_id native_key revision source_url storage_uri sha256 byte_size time_start time_end retrieved_at validation_status metadata'
  },
  data_releases: {
    keys: ['id'],
    columns:
      'id name status stream code_version config config_sha256 manifest_uri dataset_kind scope_key observation_cutoff published_at'
  },
  pipeline_runs: {
    keys: ['id'],
    columns:
      'id release_id stage idempotency_key status code_version config input_manifest_uri output_manifest_uri started_at finished_at'
  },
  data_partitions: {
    keys: ['id'],
    columns:
      'id pipeline_run_id kind series_key partition_key support_spec storage_uri sha256 input_manifest_uri schema_version row_count serving_complete validation_status'
  },
  release_assets: { keys: ['release_id', 'asset_id', 'role'], columns: 'release_id asset_id role' },
  release_partitions: {
    keys: ['release_id', 'series_key', 'partition_key'],
    columns: 'release_id series_key partition_key partition_id'
  },
  release_aliases: {
    keys: ['alias', 'scope_key'],
    columns: 'alias scope_key release_id generation updated_at'
  }
});

export function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}
export function assertExact(actual, expected, label) {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) {
    throw new Error(`Fixture collision or drift: ${label}. Existing records were not overwritten.`);
  }
}

async function insertExact(tx, Prisma, table, rows) {
  if (!Object.hasOwn(definitions, table)) throw new Error('Unknown fixture table.');
  const definition = definitions[table];
  const columns = definition.columns.split(' ');
  const tableSql = Prisma.raw(`firebridge.${table}`);
  const columnSql = Prisma.join(columns.map((column) => Prisma.raw(column)));
  const payload = JSON.stringify(rows);
  // Identifiers come exclusively from the constant definitions above.
  const created = await tx.$executeRaw(Prisma.sql`INSERT INTO ${tableSql} (${columnSql})
    SELECT ${columnSql} FROM jsonb_populate_recordset(NULL::${tableSql}, ${payload}::jsonb)
    ON CONFLICT DO NOTHING`);
  const actual = await tx.$queryRaw(Prisma.sql`
    SELECT ${Prisma.join(columns.map((column) => Prisma.raw(`t.${column}`)))} FROM ${tableSql} t
    JOIN jsonb_populate_recordset(NULL::${tableSql}, ${payload}::jsonb) seed
      ON ${Prisma.join(
        definition.keys.map((key) => Prisma.raw(`t.${key} = seed.${key}`)),
        ' AND '
      )}
  `);
  const key = (row) => definition.keys.map((field) => row[field]).join(':');
  const sorted = (values) => [...values].sort((a, b) => key(a).localeCompare(key(b)));
  assertExact(sorted(actual), sorted(rows), table);
  return { created, reused: rows.length - created, skipped: 0 };
}

export async function assertReleaseResolution(prisma) {
  const other = await prisma.$queryRaw`
    SELECT id::text FROM firebridge.data_releases WHERE status = 'published'
      AND dataset_kind IN ('satellite', 'weather', 'reports')
      AND observation_cutoff >= ${endDate}::timestamptz AND id <> ${ids.release}::uuid
    LIMIT 1`;
  if (other.length)
    throw new Error(
      'Another published release could be selected by the analysis service. Use a separate test database; no existing release will be modified.'
    );
}

export async function prepareSourceAndArea(prisma, services) {
  const source = services.sourceSchema.parse(sourceInput);
  const existing = await prisma.source.findMany({
    where: { metadata: { path: ['phase4_fixture'], equals: fixtureKey } },
    take: 2
  });
  if (existing.length > 1) throw new Error('Multiple sources carry this fixture marker.');
  let record = existing[0];
  if (record)
    assertExact(
      Object.fromEntries(Object.keys(source).map((key) => [key, record[key]])),
      source,
      'source'
    );
  else record = await services.sources.create(source);
  const input = services.areaSchema.parse(areaInput);
  const hash = services.geometryHash(input.geometry);
  const prior = await services.areaRepository.findByGeometrySha256AndVersion(hash, input.version);
  if (prior) {
    assertExact(
      { name: prior.name, provenance: prior.provenance, display_timezone: prior.display_timezone },
      { name: input.name, provenance: input.provenance, display_timezone: input.display_timezone },
      'area'
    );
  }
  const result = await services.areas.createArea(input);
  return {
    sourceId: record.id,
    areaId: result.area.id,
    counts: {
      sources: { created: existing.length ? 0 : 1, reused: existing.length ? 1 : 0, skipped: 0 },
      areas: { created: result.created ? 1 : 0, reused: result.created ? 0 : 1, skipped: 0 }
    }
  };
}

export async function ingestFixture(prisma, Prisma, sourceId, artifactUris) {
  const rows = fixtureDetections();
  const marker = { phase4_fixture: fixtureKey, synthetic: true };
  return prisma.$transaction(
    async (tx) => {
      const counts = {};
      await tx.$executeRaw`SET LOCAL search_path = firebridge, public`;
      const releases = ['release', 'other-release'].map((key) => {
        const config = { ...marker, role: key };
        return {
          id: ids[key],
          name: `${fixtureKey}-${key}`,
          status: key === 'release' ? 'published' : 'draft',
          stream: 'retrospective',
          code_version: fixtureKey,
          config,
          config_sha256: sha256(config),
          manifest_uri: artifactUris[key],
          dataset_kind: 'satellite',
          scope_key: fixtureKey,
          observation_cutoff: instant,
          published_at: key === 'release' ? instant : null
        };
      });
      counts.data_releases = await insertExact(tx, Prisma, 'data_releases', releases);
      await insertExact(tx, Prisma, 'release_aliases', [
        {
          alias: 'latest_standard',
          scope_key: fixtureKey,
          release_id: ids.release,
          generation: '1',
          updated_at: instant
        }
      ]);
      const assets = ['asset', 'other-asset'].map((key) => {
        const payload = JSON.stringify(rows.filter((row) => row.asset === key));
        return {
          id: ids[key],
          source_id: sourceId,
          native_key: `${fixtureKey}-${key}`,
          revision: '1',
          source_url: `https://example.invalid/${fixtureKey}/${key}`,
          storage_uri: artifactUris[key],
          sha256: sha256(payload),
          byte_size: String(Buffer.byteLength(payload)),
          time_start: '2026-07-31T00:00:00.000Z',
          time_end: instant,
          retrieved_at: instant,
          validation_status: 'accepted',
          metadata: marker
        };
      });
      counts.assets = await insertExact(tx, Prisma, 'assets', assets);
      counts.pipeline_runs = await insertExact(
        tx,
        Prisma,
        'pipeline_runs',
        ['pipeline', 'other-pipeline'].map((key) => ({
          id: ids[key],
          release_id: ids[key === 'pipeline' ? 'release' : 'other-release'],
          stage: 'synthetic_fixture',
          idempotency_key: `${fixtureKey}:${key}`,
          status: 'succeeded',
          code_version: fixtureKey,
          config: marker,
          input_manifest_uri: artifactUris[key === 'pipeline' ? 'asset' : 'other-asset'],
          output_manifest_uri: artifactUris[key === 'pipeline' ? 'release' : 'other-release'],
          started_at: instant,
          finished_at: instant
        }))
      );
      const partitions = ['main', 'overlap', 'quarantined', 'incomplete', 'other'].map((key) => {
        const members = key === 'overlap' ? [rows[0]] : rows.filter((row) => row.partition === key);
        return {
          id: ids[key],
          pipeline_run_id: ids[key === 'other' ? 'other-pipeline' : 'pipeline'],
          kind: 'detections',
          series_key: `${fixtureKey}:${key}`,
          partition_key: '2026-08',
          support_spec: { ...marker, partition: key, srid: 4326, source_ids: [sourceId] },
          storage_uri: artifactUris[key],
          sha256: sha256(members),
          input_manifest_uri: artifactUris[key === 'other' ? 'other-asset' : 'asset'],
          schema_version: '1',
          row_count: String(members.length),
          serving_complete: key !== 'incomplete',
          validation_status: key === 'quarantined' ? 'quarantined' : 'validated'
        };
      });
      counts.data_partitions = await insertExact(tx, Prisma, 'data_partitions', partitions);
      counts.release_assets = await insertExact(tx, Prisma, 'release_assets', [
        { release_id: ids.release, asset_id: ids.asset, role: 'detections' },
        { release_id: ids['other-release'], asset_id: ids['other-asset'], role: 'detections' }
      ]);
      counts.release_partitions = await insertExact(
        tx,
        Prisma,
        'release_partitions',
        partitions.map((partition) => ({
          release_id: [ids.other, ids.quarantined, ids.incomplete].includes(partition.id)
            ? ids['other-release']
            : ids.release,
          series_key: partition.series_key,
          partition_key: partition.partition_key,
          partition_id: partition.id
        }))
      );

      const detections = rows.map(({ partition, asset, scenario, ...row }) => {
        if (partition !== null && !Object.hasOwn(ids, partition))
          throw new Error('Unknown fixture partition.');
        return {
          ...row,
          asset_id: ids[asset],
          source_id: sourceId,
          record_sha256: sha256(row),
          identity_method: 'synthetic_native_key',
          confidence_scheme: 'synthetic_test_text',
          native_fields: { ...marker, scenario }
        };
      });
      const insertedDetections = await tx.$executeRaw`
      INSERT INTO firebridge.detections(asset_id,source_id,native_record_key,record_sha256,identity_method,
        processing_level,acquired_at,geom,confidence_raw,confidence_scheme,day_night,frp_mw,native_fields)
      SELECT asset_id,source_id,native_record_key,record_sha256,identity_method,processing_level,acquired_at,
        ST_SetSRID(ST_MakePoint(longitude,latitude),4326),confidence_raw,confidence_scheme,day_night,frp_mw,native_fields
      FROM jsonb_to_recordset(${JSON.stringify(detections)}::jsonb) AS d(asset_id uuid,source_id text,native_record_key text,
        record_sha256 text,identity_method text,processing_level text,acquired_at timestamptz,longitude float8,latitude float8,
        confidence_raw text,confidence_scheme text,day_night text,frp_mw float8,native_fields jsonb)
      ON CONFLICT DO NOTHING`;
      const actual = await tx.$queryRaw`
      SELECT asset_id::text,source_id,native_record_key,record_sha256,identity_method,processing_level,acquired_at,
        ST_X(geom) AS longitude,ST_Y(geom) AS latitude,confidence_raw,confidence_scheme,day_night,frp_mw,native_fields
      FROM firebridge.detections WHERE asset_id IN (${ids.asset}::uuid,${ids['other-asset']}::uuid)`;
      const ordered = (values) =>
        [...values].sort((a, b) => a.native_record_key.localeCompare(b.native_record_key));
      assertExact(ordered(actual), ordered(detections), 'detections');
      counts.detections = {
        created: insertedDetections,
        reused: detections.length - insertedDetections,
        skipped: 0
      };
      const memberships = rows
        .filter((row) => row.partition)
        .map((row) => ({
          partition_id: ids[row.partition],
          asset_id: ids[row.asset],
          native_record_key: row.native_record_key
        }));
      memberships.push({
        partition_id: ids.overlap,
        asset_id: ids.asset,
        native_record_key: rows[0].native_record_key
      });
      const insertedLinks = await tx.$executeRaw`
      INSERT INTO firebridge.partition_detections(partition_id,detection_id)
      SELECT m.partition_id,d.id FROM jsonb_to_recordset(${JSON.stringify(memberships)}::jsonb)
        AS m(partition_id uuid,asset_id uuid,native_record_key text)
      JOIN firebridge.detections d ON d.asset_id = m.asset_id AND d.native_record_key = m.native_record_key
      ON CONFLICT DO NOTHING`;
      const actualLinks = await tx.$queryRaw`
      SELECT pd.partition_id::text,d.asset_id::text,d.native_record_key FROM firebridge.partition_detections pd
      JOIN firebridge.detections d ON d.id = pd.detection_id
      WHERE pd.partition_id IN (${Prisma.join(partitions.map((partition) => Prisma.sql`${partition.id}::uuid`))})`;
      const links = (values) =>
        [...values].sort((a, b) =>
          `${a.partition_id}:${a.native_record_key}`.localeCompare(
            `${b.partition_id}:${b.native_record_key}`
          )
        );
      assertExact(links(actualLinks), links(memberships), 'partition membership');
      counts.partition_detections = {
        created: insertedLinks,
        reused: memberships.length - insertedLinks,
        skipped: 0
      };
      return counts;
    },
    { timeout: 30000 }
  );
}

export async function verifySelection(prisma, analysisId, detectionSelection) {
  const expected = fixtureDetections()
    .filter((row) => row.scenario === 'included')
    .map((row) => row.native_record_key)
    .sort();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL search_path = firebridge, public`;
    const selected =
      await tx.$queryRaw`SELECT d.native_record_key ${detectionSelection(analysisId)}`;
    assertExact(
      selected.map((row) => row.native_record_key).sort(),
      expected,
      'application detection selection'
    );
  });
}

export { actor };
