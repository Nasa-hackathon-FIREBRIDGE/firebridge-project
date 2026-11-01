import { createHash } from 'node:crypto';
import { ApiError } from '../utils/response.js';
import { CursorCodec } from '../utils/cursor.js';
import {
  NativeResultsRepository,
  type NativeAnalysis,
  type NativePartition,
  type NativeResultsReader,
  type NativeFilter,
  type Component
} from '../repositories/native-results.repository.js';

export type NativeQuery = {
  limit?: string;
  cursor?: string;
  source_ids?: string;
  start?: string;
  end_exclusive?: string;
  bbox?: string;
  resolution?: 'day' | 'week' | 'month';
  start_date?: string;
  end_date_exclusive?: string;
  asset_id?: string;
};
const invalid = (message: string): never => {
  throw new ApiError(422, 'INVALID_REQUEST', message);
};
function timestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value))
    return invalid('Use a UTC timestamp ending in Z, with at most millisecond precision.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10))
    return invalid('Invalid calendar date.');
  return date.toISOString();
}
function day(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid('Use dates formatted as YYYY-MM-DD.');
  return timestamp(value + 'T00:00:00Z');
}
function interval(partition: NativePartition): [number, number] | null {
  const { start, end_exclusive: end } = partition.support_spec;
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  try {
    const bounds: [number, number] = [Date.parse(timestamp(start)), Date.parse(timestamp(end))];
    return bounds[0] < bounds[1] ? bounds : null;
  } catch {
    return null;
  }
}
function sourceIds(partition: NativePartition): string[] {
  const ids = partition.support_spec.source_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}
// Complete point-feed inventory is different from satellite observation coverage.
// Publication must explicitly verify completeness for this immutable area revision.
export function coversInventory(
  parts: NativePartition[],
  source: string,
  area: string,
  start: number,
  end: number,
  cutoff: number,
  now = Date.now()
) {
  if (end > cutoff || end > now) return false;
  const ranges = parts
    .filter(
      (p) =>
        p.validation_status === 'validated' &&
        p.serving_complete &&
        p.row_count === p.stored_rows &&
        p.support_spec.inventory_complete === true &&
        p.support_spec.area_id === area &&
        sourceIds(p).includes(source)
    )
    .map(interval)
    .filter((v): v is [number, number] => v !== null)
    .sort((a, b) => a[0] - b[0]);
  let reached = start;
  for (const [left, right] of ranges) {
    if (left > reached) break;
    reached = Math.max(reached, right);
    if (reached >= end) return true;
  }
  return false;
}
function periodStart(value: string, resolution: 'day' | 'week' | 'month') {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  if (resolution === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (resolution === 'month') date.setUTCDate(1);
  return date;
}

export class NativeResultsService {
  private cursor: CursorCodec;
  constructor(
    private repository: NativeResultsRepository,
    private settings: { CURSOR_SECRET: string; MAX_POINTS_PER_PAGE: number }
  ) {
    this.cursor = new CursorCodec(settings.CURSOR_SECRET);
  }
  private async context(db: NativeResultsReader, id: string) {
    const analysis = await db.analysis(id);
    if (!analysis) throw new ApiError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found.');
    if (analysis.release_status !== 'published' || !analysis.published_at)
      throw new ApiError(409, 'RELEASE_NOT_READY', 'The pinned release is not published.');
    const components = await db.components(id);
    const satellite = components.find((c) => c.component === 'satellite');
    if (!satellite || satellite.release_id !== analysis.release_id)
      throw new ApiError(
        409,
        'INCONSISTENT_SNAPSHOT',
        'The satellite component does not match the pinned analysis.'
      );
    return { analysis, components };
  }
  private base(a: NativeAnalysis, components: Component[]) {
    return {
      analysis_id: a.id,
      data_release_id: a.release_id,
      area_id: a.area_id,
      scope_key: a.scope_key,
      metric_key: a.metric_key,
      unit: 'detections',
      time_basis: a.time_basis,
      grid_id: a.grid_id,
      area_geometry_sha256: a.geometry_sha256,
      data_mode:
        typeof a.request_spec.data_mode === 'string' &&
        ['standard_only', 'nrt_only', 'best_available'].includes(a.request_spec.data_mode)
          ? a.request_spec.data_mode
          : null,
      selection_policy: a.selection_policy,
      weighting_version: a.weighting_version,
      analysis_status: a.status,
      resolved_releases: components.map((c) => ({ ...c })),
      links: { provenance: `/api/v1/analyses/${a.id}/provenance` }
    };
  }
  private pageLimit(query: NativeQuery, max: number, defaultValue: number) {
    const limit = Number(query.limit ?? defaultValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > max)
      return invalid(`limit must be between 1 and ${max}.`);
    return limit;
  }
  private binding(
    a: NativeAnalysis,
    resource: string,
    filter: unknown,
    scope: string,
    limit: number
  ) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          analysis: a.id,
          area: a.geometry_sha256,
          selection: a.cache_key,
          request: a.request_spec,
          filter,
          scope
        })
      )
      .digest('hex');
    return { release_id: a.release_id, membership: `phase3:${resource}:${hash}`, limit };
  }
  private async selection(db: NativeResultsReader, id: string, query: NativeQuery) {
    const { analysis: a, components } = await this.context(db, id);
    const all = await db.partitions(a.release_id);
    if (all.length > 10000)
      throw new ApiError(422, 'SCOPE_TOO_LARGE', 'Use a smaller prepared serving scope.');
    const spec = a.request_spec;
    const frozen = Array.isArray(spec.source_ids) ? spec.source_ids : all.flatMap(sourceIds);
    if (!frozen.every((v): v is string => typeof v === 'string' && v.length > 0))
      throw new ApiError(503, 'INVALID_SNAPSHOT', 'The frozen source selection is invalid.');
    const allowed = [...new Set(frozen as string[])].sort();
    const selected = query.source_ids ? [...new Set(query.source_ids.split(','))].sort() : allowed;
    if (selected.length > 100 || selected.some((s) => !allowed.includes(s)))
      return invalid('Source filters must be a subset of the frozen analysis selection.');
    const start = query.start
      ? timestamp(query.start)
      : query.start_date
        ? day(query.start_date)
        : day(a.start_date);
    const end = query.end_exclusive
      ? timestamp(query.end_exclusive)
      : query.end_date_exclusive
        ? day(query.end_date_exclusive)
        : day(a.end_date_exclusive);
    if (start < day(a.start_date) || end > day(a.end_date_exclusive) || start >= end)
      return invalid('The requested interval must be inside the saved analysis.');
    let bbox: number[] | null = null;
    if (query.bbox) {
      bbox = query.bbox.split(',').map(Number);
      if (
        bbox.length !== 4 ||
        !bbox.every(Number.isFinite) ||
        bbox[0] < -180 ||
        bbox[2] > 180 ||
        bbox[1] < -90 ||
        bbox[3] > 90 ||
        bbox[0] >= bbox[2] ||
        bbox[1] >= bbox[3]
      )
        return invalid('bbox must be west,south,east,north in WGS84, with west < east.');
    }
    const parts = all.filter((p) => {
      const sources = sourceIds(p),
        bounds = interval(p);
      return (
        (!sources.length || sources.some((s) => selected.includes(s))) &&
        (!bounds || (bounds[0] < Date.parse(end) && bounds[1] > Date.parse(start)))
      );
    });
    const sources = await db.sources(selected);
    if (sources.length !== selected.length)
      throw new ApiError(503, 'INVALID_SNAPSHOT', 'A selected source is missing.');
    const mode = spec.data_mode;
    const levels = mode === 'standard_only' ? ['standard'] : mode === 'nrt_only' ? ['nrt'] : [];
    const unsupported = [];
    if (a.metric_key !== 'native_detections_v1') unsupported.push('NATIVE_METRIC_REQUIRED');
    if (a.time_basis.toUpperCase() !== 'UTC') unsupported.push('TIME_BASIS_NOT_SUPPORTED');
    if (!levels.length) unsupported.push('DATA_MODE_NOT_SUPPORTED');
    if (
      Object.entries(spec).some(
        ([key, value]) =>
          /confidence|quality|^qa_policy$|^filters$/.test(key) &&
          value != null &&
          (typeof value !== 'object' || Object.keys(value).length > 0)
      )
    )
      unsupported.push('QUALITY_POLICY_NOT_SUPPORTED');
    const serving = parts.every(
      (p) =>
        p.validation_status === 'validated' && p.serving_complete && p.row_count === p.stored_rows
    );
    const componentReady = components.find((c) => c.component === 'satellite')?.status === 'ready';
    const ready =
      serving &&
      parts.length > 0 &&
      componentReady &&
      !['failed', 'unsupported'].includes(a.status) &&
      selected.length > 0;
    const filter: NativeFilter = {
      partitions: parts.map((p) => p.id),
      sources: selected,
      levels,
      area: a.area_id,
      start,
      end,
      bbox
    };
    const complete = (source: string, left = start, right = end) =>
      ready &&
      !unsupported.length &&
      sources.some(
        (s) =>
          s.source_id === source &&
          (mode === 'standard_only'
            ? s.processing_stream === 'standard'
            : ['nrt', 'near-real-time'].includes(s.processing_stream))
      ) &&
      coversInventory(
        parts,
        source,
        a.area_id,
        Date.parse(left),
        Date.parse(right),
        new Date(a.observation_cutoff).getTime()
      );
    const inventory =
      selected.length && selected.every((s) => complete(s))
        ? 'complete'
        : ready
          ? 'partial'
          : 'unavailable';
    return { a, components, parts, sources, filter, complete, inventory, ready, unsupported };
  }
  detections(id: string, query: NativeQuery, scope: string) {
    return this.repository.read(async (db) => {
      const s = await this.selection(db, id, query);
      const max = Math.min(5000, this.settings.MAX_POINTS_PER_PAGE);
      const limit = this.pageLimit(query, max, Math.min(500, max));
      const binding = this.binding(s.a, 'detections', s.filter, scope, limit);
      const after = query.cursor ? this.cursor.decode(query.cursor, binding) : [];
      if (
        after.length &&
        (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(after[0]) ||
          !/^[1-9]\d{0,18}$/.test(after[1]) ||
          BigInt(after[1]) > 9223372036854775807n)
      )
        throw new ApiError(422, 'INVALID_CURSOR', 'Invalid detection cursor position.');
      const common = {
        ...this.base(s.a, s.components),
        selected_window: { start: s.filter.start, end_exclusive: s.filter.end },
        source_ids: s.filter.sources,
        bbox: s.filter.bbox,
        inventory_status: s.inventory,
        count_scope: 'selected_release_inventory'
      };
      if (s.unsupported.length)
        return {
          ...common,
          status: 'unsupported',
          reasons: s.unsupported,
          features: [],
          returned: 0,
          next_cursor: null,
          truncated: false
        };
      if (!s.ready)
        throw new ApiError(
          409,
          'SERVING_NOT_READY',
          'The selected serving slice is not complete and ready.'
        );
      const rows = await db.detections(s.filter, after, limit + 1),
        more = rows.length > limit,
        items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        ...common,
        status: s.inventory === 'complete' ? 'ready' : 'partial',
        reasons: s.inventory === 'complete' ? [] : ['INVENTORY_NOT_VERIFIED_COMPLETE'],
        features: items.map((row) => {
          const { longitude, latitude, asset_id, ...properties } = row;
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [longitude, latitude] },
            properties: {
              ...properties,
              evidence_link: `/api/v1/analyses/${id}/provenance?asset_id=${asset_id}`
            }
          };
        }),
        returned: items.length,
        truncated: more,
        next_cursor:
          more && last
            ? this.cursor.encode({
                ...binding,
                after: [String(last.acquired_at), String(last.detection_id)]
              })
            : null
      };
    });
  }
  summary(id: string) {
    return this.repository.read(async (db) => {
      const s = await this.selection(db, id, {});
      const rows = s.ready && !s.unsupported.length ? await db.counts(s.filter) : [];
      const counts = new Map<string, bigint>();
      for (const row of rows)
        counts.set(row.source_id, (counts.get(row.source_id) ?? 0n) + BigInt(row.count));
      const supported = s.ready && !s.unsupported.length;
      return {
        ...this.base(s.a, s.components),
        status: s.unsupported.length
          ? 'unsupported'
          : s.inventory === 'complete'
            ? 'ready'
            : s.ready
              ? 'partial'
              : 'unavailable',
        selected_window: { start: s.filter.start, end_exclusive: s.filter.end },
        inventory_status: s.inventory,
        native_detections_by_source: s.sources.map((source) => {
          const observed = counts.get(source.source_id) ?? 0n,
            complete = s.complete(source.source_id);
          return {
            ...source,
            count: supported && (complete || observed > 0n) ? observed.toString() : null,
            observed_count: supported ? observed.toString() : null,
            unit: 'detections',
            inventory_status: complete ? 'complete' : supported ? 'partial' : 'unavailable',
            count_status: complete
              ? 'complete'
              : supported && observed > 0n
                ? 'lower_bound'
                : 'unknown'
          };
        }),
        comparable_response: {
          value: null,
          unit: null,
          status: 'unsupported',
          reasons: ['NATIVE_COUNTS_ONLY']
        },
        coverage: {
          fraction: null,
          denominator: null,
          status: 'unknown',
          reasons: ['NOT_COMPUTED_FOR_NATIVE_COUNTS']
        },
        observed_vs_estimated_share: null,
        weather_status:
          s.components.find((c) => c.component === 'weather_historical')?.status ?? 'missing',
        report_counts_by_review_status: null,
        limitations: [
          ...s.unsupported,
          ...(!s.ready
            ? ['SERVING_NOT_READY']
            : s.inventory !== 'complete'
              ? ['INVENTORY_NOT_VERIFIED_COMPLETE']
              : []),
          'DETECTIONS_ARE_NOT_UNIQUE_INCIDENTS',
          'CONTEXT_COUNTS_NOT_PREPARED'
        ],
        fact_ids: s.sources.map((source) => `analysis:${id}:native-count:${source.source_id}`)
      };
    });
  }
  calendar(id: string, query: NativeQuery) {
    return this.repository.read(async (db) => {
      const s = await this.selection(db, id, query),
        resolution = query.resolution ?? 'day';
      const buckets: { key: string; start: string; end_exclusive: string }[] = [];
      for (
        let current = periodStart(s.filter.start, resolution);
        !s.unsupported.length && current.getTime() < Date.parse(s.filter.end);

      ) {
        const key = current.toISOString().slice(0, 10),
          left = current.toISOString();
        if (resolution === 'month') current.setUTCMonth(current.getUTCMonth() + 1);
        else current.setUTCDate(current.getUTCDate() + (resolution === 'week' ? 7 : 1));
        buckets.push({
          key,
          start: left < s.filter.start ? s.filter.start : left,
          end_exclusive: current.toISOString() > s.filter.end ? s.filter.end : current.toISOString()
        });
        if (buckets.length > 3660)
          throw new ApiError(422, 'SCOPE_TOO_LARGE', 'Request at most 3660 calendar periods.');
      }
      const supported = s.ready && !s.unsupported.length;
      const rows = supported ? await db.counts(s.filter, resolution) : [];
      const counts = new Map(rows.map((row) => [`${row.period}:${row.source_id}`, row.count]));
      return {
        ...this.base(s.a, s.components),
        resolution,
        inventory_status: s.inventory,
        status: s.unsupported.length
          ? 'unsupported'
          : s.inventory === 'complete'
            ? 'ready'
            : s.ready
              ? 'partial'
              : 'unavailable',
        reasons: [
          ...s.unsupported,
          ...(!s.ready
            ? ['SERVING_NOT_READY']
            : s.inventory !== 'complete'
              ? ['INVENTORY_NOT_VERIFIED_COMPLETE']
              : [])
        ],
        periods: buckets.map((period) => ({
          start: period.start,
          end_exclusive: period.end_exclusive,
          open_period: Date.parse(period.end_exclusive) > Date.now(),
          unit: 'detections',
          value: null,
          coverage_fraction: null,
          eligible_land_m2_days: null,
          possible_land_m2_days: null,
          observed_weight_fraction: null,
          baseline_year_count: null,
          seasonal_percentile: null,
          counts_by_source: s.sources.map((source) => {
            const count = counts.get(`${period.key}:${source.source_id}`) ?? '0';
            const complete = s.complete(source.source_id, period.start, period.end_exclusive);
            return {
              source_id: source.source_id,
              count: supported && (complete || count !== '0') ? count : null,
              observed_count: supported ? count : null,
              inventory_status: complete ? 'complete' : supported ? 'partial' : 'unavailable',
              count_status: complete
                ? 'complete'
                : supported && count !== '0'
                  ? 'lower_bound'
                  : 'unknown'
            };
          })
        }))
      };
    });
  }
  provenance(id: string, query: NativeQuery, scope: string) {
    return this.repository.read(async (db) => {
      const { analysis: a, components } = await this.context(db, id);
      const ids = [
        ...new Set(components.map((c) => c.release_id).filter((v): v is string => v !== null))
      ].sort();
      const limit = this.pageLimit(query, 100, 50);
      const binding = this.binding(
        a,
        'provenance',
        { releases: ids, asset: query.asset_id ?? null },
        scope,
        limit
      );
      const after = query.cursor ? this.cursor.decode(query.cursor, binding) : [];
      const rows = await db.assets(ids, query.asset_id ?? null, after, limit + 1),
        more = rows.length > limit;
      const items = rows.slice(0, limit),
        last = items.at(-1);
      return {
        ...this.base(a, components),
        status: a.status,
        provenance_scope: 'pinned_release_inputs',
        data_versions: await db.releases(ids),
        model_versions: a.metric_key === 'native_detections_v1' ? [] : null,
        preparation_status: components,
        assets: items.map((row) => {
          const { position, ...publicFields } = row;
          void position;
          return publicFields;
        }),
        returned: items.length,
        next_cursor:
          more && last
            ? this.cursor.encode({
                ...binding,
                after: [String(last.asset_id), String(last.position)]
              })
            : null
      };
    });
  }
}
