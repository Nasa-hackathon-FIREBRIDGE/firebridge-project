import { evidenceHash, type EvidenceBundle } from '@firebridge/contracts';
import { ContextRepository, type AnalysisContext } from '../repositories/context.repository.js';
import { NativeResultsReader } from '../repositories/native-results.repository.js';
import type { SqlReader } from '../repositories/database.js';
import type { NativeResultsService } from './native-results.service.js';
import type {
  CoverageQuery,
  CellQuery,
  ComparisonQuery,
  WeatherQuery,
  ReportsQuery
} from '../validators/context.validator.js';
import { CursorCodec } from '../utils/cursor.js';
import { ApiError } from '../utils/response.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message: string): never => {
  throw new ApiError(422, 'INVALID_REQUEST', message);
};
function publicUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    if (
      !['https:', 'http:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      /localhost|private|secret|token|MAP_KEY|credential/i.test(u.hostname + u.pathname) ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/.test(u.hostname)
    )
      return null;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export class ContextService {
  private cursor: CursorCodec;
  constructor(
    readonly repository: ContextRepository,
    private native: NativeResultsService,
    private settings: { CURSOR_SECRET: string; MAX_EVIDENCE_CELL_DAYS: number }
  ) {
    this.cursor = new CursorCodec(settings.CURSOR_SECRET);
  }
  private base(c: AnalysisContext) {
    return {
      analysis_id: c.a.id,
      data_release_id: c.a.release_id,
      area_id: c.a.area_id,
      metric_key: c.a.metric_key,
      time_basis: c.a.time_basis,
      grid_id: c.a.grid_id,
      resolved_releases: c.components,
      links: { provenance: `/api/v1/analyses/${c.a.id}/provenance` }
    };
  }
  private window(c: AnalysisContext, q: { start_date?: string; end_date_exclusive?: string }) {
    const start = q.start_date ?? c.a.start_date,
      end = q.end_date_exclusive ?? c.a.end_date_exclusive;
    if (start < c.a.start_date || end > c.a.end_date_exclusive || start >= end)
      invalid('The window must narrow the saved analysis.');
    return { start, end };
  }
  private binding(c: AnalysisContext, path: string, q: object, scope: string, limit: number) {
    const filters = Object.fromEntries(Object.entries(q).filter(([k]) => k !== 'cursor'));
    return {
      release_id: c.a.release_id,
      membership:
        'phase6:' +
        path +
        ':' +
        evidenceHash({
          analysis: c.a.id,
          cache: c.a.cache_key,
          components: c.components,
          filters,
          scope
        }),
      limit
    };
  }
  private async scientific(db: SqlReader, c: AnalysisContext) {
    const r = c.config.scientific_serving_v1 as Record<string, unknown> | undefined;
    if (
      !c.a.grid_id ||
      !r ||
      r.publication_gates_passed !== true ||
      r.mask_inventory_verified !== true ||
      r.metric_key !== c.a.metric_key ||
      r.grid_id !== c.a.grid_id ||
      r.time_basis !== c.a.time_basis ||
      r.selection_policy !== c.a.selection_policy ||
      r.weighting_version !== c.a.weighting_version ||
      typeof r.support_definition_sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(r.support_definition_sha256) ||
      typeof r.qa_policy_version !== 'string' ||
      !['ready', 'partial'].includes(c.a.status) ||
      c.components.find((v) => v.component === 'satellite')?.status !== 'ready'
    )
      return null;
    const mask = await db.query<{ requires_model: boolean }>(
      `SELECT m.requires_model FROM firebridge.grids g
      JOIN firebridge.assets a ON a.id=g.land_mask_asset_id
      JOIN firebridge.metric_definitions m ON m.id=$2
      WHERE g.id=$1 AND a.validation_status='accepted'`,
      [c.a.grid_id, c.a.metric_key]
    );
    if (!mask.length) return null;
    const sources = r.source_ids,
      requested = c.a.request_spec.source_ids;
    if (
      !Array.isArray(sources) ||
      !sources.length ||
      sources.length > 100 ||
      !sources.every((v) => typeof v === 'string') ||
      !Array.isArray(requested) ||
      evidenceHash([...new Set(sources)].sort()) !== evidenceHash([...new Set(requested)].sort())
    )
      return null;
    const models = Array.isArray(r.model_ids) ? r.model_ids : [];
    if (!models.every((v) => typeof v === 'string' && uuid.test(v)) || models.length > 100)
      return null;
    if (mask[0].requires_model && !models.length) return null;
    if (models.length) {
      const found = await db.query(
        `SELECT id FROM firebridge.model_versions WHERE id=ANY($1::uuid[]) AND status='validated'`,
        [models]
      );
      if (found.length !== new Set(models).size) return null;
    }
    return {
      model_ids: models as string[],
      source_ids: sources as string[],
      qa_policy_version: r.qa_policy_version,
      support_definition_sha256: r.support_definition_sha256
    };
  }
  coverage(id: string, q: CoverageQuery): Promise<Record<string, unknown>> {
    return this.repository.read(async (db) => {
      const c = await this.repository.context(db, id),
        w = this.window(c, q);
      const common = {
        ...this.base(c),
        selected_window: w,
        observation_coverage_status: 'unknown',
        coverage_fraction: null,
        eligible_land_m2_days: null,
        possible_land_m2_days: null,
        observed_cell_days: null,
        estimated_cell_days: null,
        missing_cell_days: null,
        cloud_land_m2: null,
        invalid_land_m2: null,
        unobserved_land_m2: null,
        ingestion_status: 'not_assessed'
      };
      const receipt = await this.scientific(db, c);
      if (!receipt || c.a.time_basis.toLowerCase() !== 'utc')
        return {
          ...common,
          status: 'unsupported',
          reasons: [
            c.a.grid_id
              ? 'VALIDATED_SCIENTIFIC_INPUTS_REQUIRED'
              : 'GRID_AND_OBSERVATION_MASKS_REQUIRED'
          ]
        };
      if (q.cell_id)
        return {
          ...common,
          status: 'unsupported',
          reasons: ['CELL_COVERAGE_AGGREGATE_NOT_PREPARED']
        };
      const weights = await db.query<{ cells: string; area: number }>(
        `SELECT count(*)::text AS cells,
        sum(ac.overlap_land_area_m2) AS area FROM firebridge.area_cells ac JOIN firebridge.grid_cells g ON g.id=ac.cell_id
        WHERE ac.area_id=$1::uuid AND ac.weighting_version=$2 AND g.grid_id=$3`,
        [c.a.area_id, c.a.weighting_version, c.a.grid_id]
      );
      const days = (Date.parse(w.end) - Date.parse(w.start)) / 86400000;
      const expected = Number(weights[0].cells) * days;
      if (!expected || expected > this.settings.MAX_EVIDENCE_CELL_DAYS)
        return { ...common, status: 'unsupported', reasons: ['PREPARED_CELL_DAY_SCOPE_REQUIRED'] };
      const daily = await db.query<{
        observed: string;
        estimated: string;
        missing: string;
        total: string;
        masks_missing: string;
      }>(
        `
        SELECT count(*) FILTER(WHERE d.status='reference_observed')::text AS observed,
        count(*) FILTER(WHERE d.status='source_estimated')::text AS estimated,
        count(*) FILTER(WHERE d.status NOT IN ('reference_observed','source_estimated'))::text AS missing,
        count(*)::text AS total,
        count(*) FILTER(WHERE d.status IN ('reference_observed','source_estimated') AND
          (o.id IS NULL OR NOT o.eligible OR o.qa_policy_version<>$9 OR NOT (o.source_id=ANY($11::text[])) OR
           (d.status='source_estimated' AND (p.id IS NULL OR p.status<>'supported' OR m.status<>'validated' OR
            NOT(p.model_id=ANY($12::uuid[])))) OR NOT EXISTS(SELECT 1 FROM firebridge.observation_assets oa
            JOIN firebridge.assets a ON a.id=oa.asset_id WHERE oa.observation_id=o.id
            AND oa.role='fire_mask' AND a.validation_status='accepted') OR
           NOT EXISTS(SELECT 1 FROM firebridge.observation_assets oa JOIN firebridge.assets a ON a.id=oa.asset_id
            WHERE oa.observation_id=o.id AND oa.role='geolocation' AND a.validation_status='accepted')))::text AS masks_missing
        FROM firebridge.daily_activity d JOIN firebridge.area_cells ac ON ac.cell_id=d.cell_id
        JOIN firebridge.grid_cells g ON g.id=d.cell_id
        LEFT JOIN firebridge.observations o ON o.id=d.observation_id AND o.release_id=d.release_id
        LEFT JOIN firebridge.predictions p ON p.id=d.prediction_id AND p.release_id=d.release_id
        LEFT JOIN firebridge.model_versions m ON m.id=p.model_id
        WHERE ac.area_id=$1::uuid AND ac.weighting_version=$2 AND g.grid_id=$3 AND d.release_id=$4::uuid
        AND d.reporting_date>=$5::date AND d.reporting_date<$6::date
        AND d.time_basis=$7 AND d.metric_key=$8 AND d.selection_policy=$10`,
        [
          c.a.area_id,
          c.a.weighting_version,
          c.a.grid_id,
          c.a.release_id,
          w.start,
          w.end,
          c.a.time_basis,
          c.a.metric_key,
          receipt.qa_policy_version,
          c.a.selection_policy,
          receipt.source_ids,
          receipt.model_ids
        ]
      );
      const periods = await db.query<{
        eligible_land_m2_days: number;
        possible_land_m2_days: number;
        status: string;
        valid_cell_days: string;
      }>(
        `
        SELECT eligible_land_m2_days,possible_land_m2_days,status,valid_cell_days::text
        FROM firebridge.calendar_periods WHERE analysis_id=$1::uuid AND resolution='selection'
        AND period_start=$2::date AND period_end_exclusive=$3::date`,
        [id, w.start, w.end]
      );
      const p = periods[0],
        d = daily[0];
      if (
        !p ||
        !['supported', 'limited'].includes(p.status) ||
        Number(d.total) !== expected ||
        d.masks_missing !== '0' ||
        !Number.isFinite(p.possible_land_m2_days) ||
        !Number.isFinite(p.eligible_land_m2_days) ||
        Math.abs(p.possible_land_m2_days - weights[0].area * days) >
          Math.max(1, weights[0].area * days) * 1e-8 ||
        Number(p.valid_cell_days) !== Number(d.observed) + Number(d.estimated)
      )
        return {
          ...common,
          status: 'unavailable',
          reasons: ['CONSISTENT_PREPARED_COVERAGE_REQUIRED']
        };
      return {
        ...common,
        status: p.status === 'supported' ? 'ready' : 'partial',
        observation_coverage_status: p.status,
        coverage_fraction: p.eligible_land_m2_days / p.possible_land_m2_days,
        eligible_land_m2_days: p.eligible_land_m2_days,
        possible_land_m2_days: p.possible_land_m2_days,
        observed_cell_days: d.observed,
        estimated_cell_days: d.estimated,
        missing_cell_days: d.missing,
        support_definition_sha256: receipt.support_definition_sha256,
        qa_policy_version: receipt.qa_policy_version,
        reasons: ['CLOUD_AREA_UNION_NOT_PREPARED', 'INGESTION_COMPLETENESS_IS_SEPARATE']
      };
    });
  }
  cell(id: string, cellId: string, q: CellQuery, scope: string): Promise<Record<string, unknown>> {
    if (BigInt(cellId) > 9223372036854775807n) invalid('cell_id exceeds bigint range.');
    return this.repository.read(async (db) => {
      const c = await this.repository.context(db, id),
        w = this.window(c, q),
        binding = this.binding(c, 'cell:' + cellId, q, scope, q.limit);
      if (
        (Date.parse(w.end) - Date.parse(w.start)) / 86400000 >
        this.settings.MAX_EVIDENCE_CELL_DAYS
      )
        invalid('Narrow the cell evidence window.');
      const after = q.cursor ? this.cursor.decode(q.cursor, binding)[0] : null;
      if (after && !uuid.test(after)) invalid('Invalid cell cursor.');
      const cells = await db.query<Record<string, unknown>>(
        `SELECT g.id::text,g.grid_id,
        ST_AsGeoJSON(g.geom)::jsonb AS geometry,ac.overlap_land_area_m2
        FROM firebridge.grid_cells g JOIN firebridge.areas a ON a.id=$2::uuid
        LEFT JOIN firebridge.area_cells ac ON ac.cell_id=g.id AND ac.area_id=a.id AND ac.weighting_version=$3
        WHERE g.id=$1::bigint AND ST_Intersects(g.geom,a.geom)`,
        [cellId, c.a.area_id, c.a.weighting_version]
      );
      if (!cells.length)
        throw new ApiError(404, 'CELL_NOT_FOUND', 'Cell is not available in this analysis area.');
      const common = {
        ...this.base(c),
        cell: cells[0],
        selected_window: w,
        observations: [],
        next_cursor: null
      };
      const receipt = await this.scientific(db, c);
      if (
        !receipt ||
        c.a.time_basis.toLowerCase() !== 'utc' ||
        cells[0].grid_id !== c.a.grid_id ||
        !cells[0].overlap_land_area_m2
      )
        return {
          ...common,
          status: 'unsupported',
          reasons: ['VALIDATED_GRID_WEIGHTS_AND_MASKS_REQUIRED']
        };
      const observations = await db.query<Record<string, unknown>>(
        `SELECT o.id::text,o.source_id,o.pass_key,
        o.time_start::text,o.time_end::text,o.representative_time::text,o.coverage_status,o.eligible,
        o.retained_detection_count,o.retained_any,o.qa_policy_version,
        (EXISTS(SELECT 1 FROM firebridge.observation_assets oa JOIN firebridge.assets ma ON ma.id=oa.asset_id
          WHERE oa.observation_id=o.id AND oa.role='fire_mask' AND ma.validation_status='accepted') AND
         EXISTS(SELECT 1 FROM firebridge.observation_assets oa JOIN firebridge.assets ma ON ma.id=oa.asset_id
          WHERE oa.observation_id=o.id AND oa.role='geolocation' AND ma.validation_status='accepted')) AS mask_assets_valid,
        (SELECT jsonb_agg(jsonb_build_object('model_id',m.id,'model_name',m.name,'model_version',m.version,
          'status',p.status,'response_probability',p.response_probability) ORDER BY m.id)
         FROM firebridge.predictions p JOIN firebridge.model_versions m ON m.id=p.model_id
         WHERE p.observation_id=o.id AND p.release_id=o.release_id AND m.status='validated'
           AND p.model_id=ANY($11::uuid[])) AS predictions,
        (SELECT jsonb_agg(jsonb_build_object('asset_id',a.id,'role',oa.role,'sha256',a.sha256)
          ORDER BY a.id,oa.role) FROM firebridge.observation_assets oa JOIN firebridge.assets a ON a.id=oa.asset_id
          WHERE oa.observation_id=o.id AND a.validation_status='accepted') AS assets,
        (SELECT jsonb_agg(jsonb_build_object('date',d.reporting_date,'status',d.status)
          ORDER BY d.reporting_date) FROM firebridge.daily_activity d WHERE d.observation_id=o.id
          AND d.release_id=o.release_id AND d.time_basis=$7 AND d.metric_key=$8 AND d.selection_policy=$9
          AND d.reporting_date>=$3::date AND d.reporting_date<$4::date) AS selected_days
        FROM firebridge.observations o WHERE o.release_id=$1::uuid AND o.cell_id=$2::bigint
        AND o.time_start<$4::date AND o.time_end>=$3::date AND ($5::uuid IS NULL OR o.id>$5::uuid)
        AND o.qa_policy_version=$6 AND o.source_id=ANY($12::text[]) ORDER BY o.id LIMIT $10`,
        [
          c.a.release_id,
          cellId,
          w.start,
          w.end,
          after,
          receipt.qa_policy_version,
          c.a.time_basis,
          c.a.metric_key,
          c.a.selection_policy,
          q.limit + 1,
          receipt.model_ids,
          receipt.source_ids
        ]
      );
      const selected = observations.slice(0, q.limit);
      if (selected.some((o) => o.eligible && !o.mask_assets_valid))
        return { ...common, status: 'unavailable', reasons: ['VALIDATED_COMPANIONS_REQUIRED'] };
      return {
        ...common,
        status: 'ready',
        observations: selected,
        returned: selected.length,
        next_cursor:
          observations.length > q.limit
            ? this.cursor.encode({ ...binding, after: [String(selected.at(-1)!.id), ''] })
            : null,
        reasons: [],
        qa_policy_version: receipt.qa_policy_version
      };
    });
  }
  async comparison(id: string, q: ComparisonQuery): Promise<Record<string, unknown>> {
    if (q.view === 'native_counts') {
      const calendar = await this.native.calendar(id, { resolution: q.resolution });
      return {
        ...calendar,
        view: q.view,
        unit: 'detections',
        support_definition: 'source_native_detection_inventory',
        series: calendar.periods.length
          ? calendar.periods[0].counts_by_source.map((s) => ({
              source_id: s.source_id,
              values: calendar.periods.map((p) => ({
                start: p.start,
                end_exclusive: p.end_exclusive,
                count: p.counts_by_source.find((v) => v.source_id === s.source_id)?.count ?? null
              }))
            }))
          : [],
        limitations: [
          'NATIVE_COUNTS_ARE_NOT_HARMONIZED',
          'DIFFERENT_SENSOR_SUPPORT',
          'DETECTIONS_ARE_NOT_UNIQUE_INCIDENTS'
        ]
      };
    }
    return this.repository.read(async (db) => {
      const c = await this.repository.context(db, id),
        receipt = await this.scientific(db, c);
      const common = {
        ...this.base(c),
        view: q.view,
        resolution: q.resolution,
        status: 'unsupported',
        series: null
      };
      const experiment = c.a.request_spec.comparison_experiment_id;
      if (!receipt || typeof experiment !== 'string' || !uuid.test(experiment))
        return { ...common, reasons: ['PINNED_VALIDATED_COMPARISON_EXPERIMENT_REQUIRED'] };
      const rows = await db.query<{
        model_id: string;
        sample_count: string;
        positive_count: string;
        independent_block_count: number;
        metrics: Record<string, unknown>;
        baseline_metrics: unknown;
      }>(
        `SELECT e.model_id::text,e.sample_count::text,
        e.positive_count::text,e.independent_block_count,e.metrics,e.baseline_metrics
        FROM firebridge.evaluations e JOIN firebridge.model_versions m ON m.id=e.model_id
        WHERE e.id=$1::uuid AND e.release_id=$2::uuid AND m.status='validated'`,
        [experiment, c.a.release_id]
      );
      const row = rows[0],
        artifact = row?.metrics.public_comparison_v1 as Record<string, unknown> | undefined;
      if (
        !row ||
        !receipt.model_ids.includes(row.model_id) ||
        !artifact ||
        artifact.area_id !== c.a.area_id ||
        artifact.start_date !== c.a.start_date ||
        artifact.end_date_exclusive !== c.a.end_date_exclusive ||
        artifact.resolution !== q.resolution ||
        artifact.view !== q.view ||
        artifact.publication_gates_passed !== true ||
        artifact.support_definition_sha256 !== receipt.support_definition_sha256 ||
        !Array.isArray(artifact.series) ||
        artifact.series.length > 100 ||
        artifact.unit !== 'dimensionless_reference_response' ||
        (q.view === 'withheld_reference' &&
          (artifact.held_out_verified !== true || row.independent_block_count < 1))
      )
        return { ...common, reasons: ['MATCHING_PRECOMPUTED_COMPARISON_REQUIRED'] };
      const series = [];
      for (const s of artifact.series as Record<string, unknown>[]) {
        if (
          !s ||
          typeof s !== 'object' ||
          typeof s.source_id !== 'string' ||
          !Array.isArray(s.values) ||
          s.values.length > 3660
        )
          return { ...common, reasons: ['INVALID_COMPARISON_ARTIFACT'] };
        const values = [];
        for (const v of s.values as Record<string, unknown>[]) {
          const day = (value: unknown) =>
            typeof value === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(value) &&
            Number.isFinite(Date.parse(value)) &&
            new Date(value).toISOString().slice(0, 10) === value;
          if (
            !v ||
            !day(v.start) ||
            !day(v.end_exclusive) ||
            typeof v.start !== 'string' ||
            typeof v.end_exclusive !== 'string' ||
            v.start < c.a.start_date ||
            v.end_exclusive > c.a.end_date_exclusive ||
            v.start >= v.end_exclusive ||
            (v.value !== null &&
              (typeof v.value !== 'number' ||
                !Number.isFinite(v.value) ||
                v.value < 0 ||
                v.value > 1))
          )
            return { ...common, reasons: ['INVALID_COMPARISON_ARTIFACT'] };
          values.push({ start: v.start, end_exclusive: v.end_exclusive, value: v.value });
        }
        series.push({ source_id: s.source_id, values });
      }
      return {
        ...common,
        status: 'ready',
        series,
        unit: artifact.unit,
        experiment_id: experiment,
        support_definition_sha256: receipt.support_definition_sha256,
        sample_count: row.sample_count,
        positive_count: row.positive_count,
        independent_block_count: row.independent_block_count,
        limitations: ['PRECOMPUTED_EXPERIMENT_ONLY', 'NO_TRAINING_ON_REQUEST']
      };
    });
  }
  weather(id: string, q: WeatherQuery, scope: string): Promise<Record<string, unknown>> {
    return this.repository.read(async (db) => {
      const c = await this.repository.context(db, id),
        binding = this.binding(c, 'weather', q, scope, q.limit);
      const after = q.cursor ? this.cursor.decode(q.cursor, binding)[0] : null;
      const names =
        q.context === 'historical'
          ? ['weather_historical']
          : q.context === 'recent'
            ? ['weather_recent']
            : ['weather_historical', 'weather_recent'];
      const releases: string[] = [];
      for (const name of names) {
        const release = await this.repository.component(db, c, name, 'weather');
        if (release) releases.push(release);
      }
      const common = {
        ...this.base(c),
        context: q.context,
        resolution: q.resolution,
        series: [],
        returned: 0,
        next_cursor: null
      };
      if (!releases.length)
        return { ...common, status: 'missing', reasons: ['WEATHER_COMPONENT_MISSING'] };
      if (c.a.time_basis.toLowerCase() !== 'utc')
        return { ...common, status: 'unsupported', reasons: ['UTC_CONTEXT_REQUIRED'] };
      const field = 'weather_value_ids' as const;
      const all = new Set<string>();
      const membership = new Map<string, string[]>();
      for (const release of new Set(releases)) {
        const members = await this.repository.members(db, release, 'weather', field);
        if (!members.ready)
          return {
            ...common,
            status: 'unavailable',
            reasons: ['EXACT_WEATHER_MEMBERSHIP_REQUIRED']
          };
        const kinds =
          c.components.some(
            (v) => v.component === 'weather_historical' && v.release_id === release
          ) && names.includes('weather_historical')
            ? ['reanalysis', 'station_observation']
            : [];
        if (
          c.components.some((v) => v.component === 'weather_recent' && v.release_id === release) &&
          names.includes('weather_recent')
        )
          kinds.push('forecast', 'model_current');
        const count = await db.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM firebridge.weather_values v
            JOIN firebridge.assets a ON a.id=v.asset_id AND a.validation_status='accepted'
            WHERE v.id=ANY($1::bigint[]) AND v.data_kind=ANY($3::text[]) AND EXISTS(SELECT 1 FROM firebridge.release_assets ra
              WHERE ra.release_id=$2::uuid AND ra.asset_id=v.asset_id)`,
          [members.ids, release, kinds]
        );
        if (Number(count[0].count) !== members.ids.length)
          return { ...common, status: 'unavailable', reasons: ['WEATHER_MEMBERSHIP_INCONSISTENT'] };
        membership.set(release, members.ids);
        members.ids.forEach((v) => all.add(v));
      }
      const manifests = new Map<string, string>();
      const manifestMembers: Record<string, string[]> = {};
      for (const component of c.components.filter(
        (v) => names.includes(v.component) && v.release_id && releases.includes(v.release_id)
      )) {
        const hash = evidenceHash({
          analysis_id: id,
          component: component.component,
          release_id: component.release_id,
          weather_value_ids: membership.get(component.release_id!)!,
          area_id: c.a.area_id,
          weighting_version: c.a.weighting_version,
          start_date: c.a.start_date,
          end_date_exclusive: c.a.end_date_exclusive
        });
        manifests.set('urn:firebridge:weather-inputs-v1:' + hash, component.component);
        manifestMembers['urn:firebridge:weather-inputs-v1:' + hash] = membership.get(
          component.release_id!
        )!;
      }
      const variables = q.variables ? [...new Set(q.variables.split(','))].sort() : null;
      if (variables && variables.length > 20) invalid('Request at most 20 weather variables.');
      if (
        after &&
        (q.resolution === 'hour' ? !/^[1-9][0-9]{0,18}$/.test(after) : !uuid.test(after))
      )
        invalid('Invalid weather cursor.');
      if (after && q.resolution === 'hour' && BigInt(after) > 9223372036854775807n)
        invalid('Invalid weather cursor.');
      let rows: Record<string, unknown>[];
      if (q.resolution === 'hour') {
        rows = await db.query<Record<string, unknown>>(
          `SELECT v.id::text,v.source_id,v.variable,v.unit,
          v.valid_start::text,v.valid_end::text,v.issued_at::text,v.data_kind,v.statistic,v.value,v.quality_status,
          l.id::text AS location_id,l.support_kind,l.native_resolution_m,ST_AsGeoJSON(l.geom)::jsonb AS geometry,
          s.product AS source_model,s.citation,v.asset_id::text
          FROM firebridge.weather_values v JOIN firebridge.weather_locations l ON l.id=v.location_id
          JOIN firebridge.sources s ON s.id=v.source_id JOIN firebridge.areas a ON a.id=$2::uuid
          WHERE v.id=ANY($1::bigint[]) AND v.valid_start<$4::date
          AND v.valid_end<=v.valid_start+interval '1 hour'
          AND (v.valid_end>$3::date OR (v.valid_end=v.valid_start AND v.valid_start>=$3::date))
          AND (ST_Covers(a.geom,l.geom) OR (l.footprint IS NOT NULL AND ST_Intersects(a.geom,l.footprint)))
          AND ($5::text[] IS NULL OR v.variable=ANY($5::text[]))
          AND ($6::bigint IS NULL OR v.id>$6::bigint)
          AND ($7='both' OR ($7='historical' AND v.data_kind IN ('reanalysis','station_observation'))
            OR ($7='recent' AND v.data_kind IN ('forecast','model_current')))
          ORDER BY v.id LIMIT $8`,
          [
            [...all],
            c.a.area_id,
            c.a.start_date,
            c.a.end_date_exclusive,
            variables,
            after,
            q.context,
            q.limit + 1
          ]
        );
      } else {
        rows = await db.query<Record<string, unknown>>(
          `SELECT w.id::text,w.source_id,w.variable,w.unit,
          w.period_start::text AS valid_start,w.period_end::text AS valid_end,w.statistic,w.value,w.status,
          w.spatial_method,w.spatial_coverage_fraction,w.temporal_coverage_fraction,s.product AS source_model,s.citation,
          w.input_manifest_uri AS internal_manifest
          FROM firebridge.weather_summaries w JOIN firebridge.sources s ON s.id=w.source_id
          WHERE w.input_manifest_uri=ANY($1::text[]) AND w.analysis_id=$2::uuid AND w.period_start>=$3::date
          AND EXISTS(SELECT 1 FROM jsonb_each($9::jsonb) manifest JOIN firebridge.weather_values v
            ON v.id IN(SELECT value::bigint FROM jsonb_array_elements_text(manifest.value))
            WHERE manifest.key=w.input_manifest_uri AND v.source_id=w.source_id)
          AND w.spatial_method IN ('area_weighted','point_sample')
          AND w.period_end<=$4::date AND ($5::text[] IS NULL OR w.variable=ANY($5::text[]))
          AND ($6::uuid IS NULL OR w.id>$6::uuid)
          AND (($7='day' AND w.period_end=w.period_start+interval '1 day'
            AND w.period_start=date_trunc('day',w.period_start)) OR
            ($7='period' AND w.period_start=$3::date AND w.period_end=$4::date))
          ORDER BY w.id LIMIT $8`,
          [
            [...manifests.keys()],
            id,
            c.a.start_date,
            c.a.end_date_exclusive,
            variables,
            after,
            q.resolution,
            q.limit + 1,
            JSON.stringify(manifestMembers)
          ]
        );
      }
      const selected: Record<string, unknown>[] = rows
        .slice(0, q.limit)
        .map(({ internal_manifest, ...row }) => ({
          ...row,
          context_component: internal_manifest
            ? manifests.get(String(internal_manifest))
            : ['reanalysis', 'station_observation'].includes(String(row.data_kind))
              ? 'weather_historical'
              : 'weather_recent',
          spatial_method: row.spatial_method ?? 'native_location',
          value:
            (row.quality_status === 'valid' ||
              ['supported', 'limited'].includes(String(row.status))) &&
            typeof row.value === 'number' &&
            Number.isFinite(row.value)
              ? row.value
              : null
        }));
      return {
        ...common,
        status: !selected.length
          ? 'missing'
          : selected.some((v) => v.value === null) ||
              c.components.some((v) => names.includes(v.component) && v.status === 'partial')
            ? 'partial'
            : 'ready',
        series: selected,
        returned: selected.length,
        context_release_ids: [...new Set(releases)],
        next_cursor:
          rows.length > q.limit
            ? this.cursor.encode({ ...binding, after: [String(selected.at(-1)!.id), ''] })
            : null,
        reasons:
          q.resolution === 'hour'
            ? ['NATIVE_LOCATIONS_NOT_AREA_AGGREGATES']
            : ['PREPARED_ANALYSIS_BOUND_SUMMARIES']
      };
    });
  }
  reports(id: string, q: ReportsQuery, scope: string): Promise<Record<string, unknown>> {
    return this.repository.read(async (db) => {
      const c = await this.repository.context(db, id),
        binding = this.binding(c, 'reports', q, scope, q.limit);
      const after = q.cursor ? this.cursor.decode(q.cursor, binding)[0] : null;
      if (after && !uuid.test(after)) invalid('Invalid reports cursor.');
      const release = await this.repository.component(db, c, 'reports', 'reports');
      const common = { ...this.base(c), reports: [], returned: 0, next_cursor: null };
      if (!release) return { ...common, status: 'missing', reasons: ['REPORTS_COMPONENT_MISSING'] };
      const members = await this.repository.members(db, release, 'reports', 'reported_event_ids');
      if (!members.ready)
        return { ...common, status: 'unavailable', reasons: ['EXACT_REPORT_MEMBERSHIP_REQUIRED'] };
      const count = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM firebridge.reported_events e
        JOIN firebridge.news_reports n ON n.id=e.report_id JOIN firebridge.assets a ON a.id=n.asset_id
        WHERE e.id=ANY($1::uuid[]) AND a.validation_status='accepted' AND EXISTS(
          SELECT 1 FROM firebridge.release_assets ra WHERE ra.release_id=$2::uuid AND ra.asset_id=n.asset_id)`,
        [members.ids, release]
      );
      if (Number(count[0].count) !== members.ids.length)
        return { ...common, status: 'unavailable', reasons: ['REPORT_MEMBERSHIP_INCONSISTENT'] };
      const rows = await db.query<Record<string, unknown>>(
        `SELECT e.id::text AS event_id,e.report_id::text,
        e.event_start::text,e.event_end_exclusive::text,e.date_precision,e.place_text,
        ST_AsGeoJSON(e.location)::jsonb AS geometry,e.location_precision,e.location_uncertainty_m,
        e.claim_summary,e.review_status AS claim_review_status,n.title,n.publisher,n.canonical_url,
        n.published_at::text,n.publication_precision,n.review_status AS report_review_status,n.source_lineage,
        n.syndication_group,link.relation,link.independence,link.match_method_version
        FROM firebridge.reported_events e JOIN firebridge.news_reports n ON n.id=e.report_id
        JOIN LATERAL(SELECT l.* FROM firebridge.analysis_event_links l WHERE l.event_id=e.id AND l.analysis_id=$2::uuid
          ORDER BY l.reviewed_at DESC NULLS LAST,l.match_method_version DESC LIMIT 1) link ON true
        WHERE e.id=ANY($1::uuid[]) AND (e.event_end_exclusive IS NULL OR e.event_end_exclusive>$3::date)
        AND (e.event_start IS NULL OR e.event_start<$4::date)
        AND ($5::text IS NULL OR link.relation=$5)
        AND ($6::text IS NULL OR (e.review_status=$6 AND n.review_status=$6))
        AND ($7::uuid IS NULL OR e.id>$7::uuid) ORDER BY e.id LIMIT $8`,
        [
          members.ids,
          id,
          c.a.start_date,
          c.a.end_date_exclusive,
          q.relation ?? null,
          q.review_status ?? null,
          after,
          q.limit + 1
        ]
      );
      const selected: Record<string, unknown>[] = rows
        .slice(0, q.limit)
        .map(({ canonical_url, ...row }) => ({ ...row, url: publicUrl(canonical_url) }));
      return {
        ...common,
        status:
          c.components.find((v) => v.component === 'reports')?.status === 'partial'
            ? 'partial'
            : 'ready',
        reports: selected,
        returned: selected.length,
        context_release_id: release,
        next_cursor:
          rows.length > q.limit
            ? this.cursor.encode({ ...binding, after: [String(selected.at(-1)!.event_id), ''] })
            : null,
        reasons: ['COLLECTED_REPORTS_ARE_NOT_A_COMPLETE_INCIDENT_INVENTORY']
      };
    });
  }
  async evidence(db: SqlReader, id: string): Promise<EvidenceBundle> {
    const summary = await this.native.summaryFromReader(new NativeResultsReader(db), id);
    return {
      schema_version: '1',
      analysis_id: summary.analysis_id,
      release_id: summary.data_release_id,
      area_id: summary.area_id,
      start_date: summary.selected_window.start.slice(0, 10),
      end_date_exclusive: summary.selected_window.end_exclusive.slice(0, 10),
      time_basis: summary.time_basis,
      facts: summary.native_detections_by_source.map((s) => ({
        id: 'native-count:' + s.source_id,
        source_id: s.source_id,
        value: s.count,
        unit: 'detections',
        status: s.count_status
      })),
      citations: summary.native_detections_by_source.map((s) => ({
        id: 'source:' + s.source_id,
        source_id: s.source_id,
        citation: s.citation,
        product: s.product,
        collection: s.collection
      })),
      limitations: summary.limitations
    };
  }
}
