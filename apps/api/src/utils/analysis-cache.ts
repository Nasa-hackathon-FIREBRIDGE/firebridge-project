import { createHash } from 'node:crypto';

/** Object-key order is irrelevant; array order remains part of the policy. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function computeAnalysisRequestHash(request: Record<string, unknown>): string {
  return createHash('sha256').update(canonical(request)).digest('hex');
}
export function computeAnalysisCacheKey(input: {
  request_spec: Record<string, unknown>;
  satellite_release_id: string;
  weather_release_id: string | null;
  reports_release_id: string | null;
}): string {
  return computeAnalysisRequestHash({
    cache_schema: 3,
    ...input,
    satellite_release_id: input.satellite_release_id.toLowerCase(),
    weather_release_id: input.weather_release_id?.toLowerCase() ?? null,
    reports_release_id: input.reports_release_id?.toLowerCase() ?? null
  });
}
