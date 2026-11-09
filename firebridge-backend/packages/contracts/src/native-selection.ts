/** Shared serving rules for native reads, map tiles and exports. */
export interface NativePartitionScope {
  id: string;
  support_spec: Record<string, unknown>;
}
export function nativeProcessingLevels(spec: Record<string, unknown>): string[] {
  return spec.data_mode === 'standard_only'
    ? ['standard']
    : spec.data_mode === 'nrt_only'
      ? ['nrt']
      : [];
}
export function unsupportedNativePolicies(spec: Record<string, unknown>): boolean {
  return Object.entries(spec).some(
    ([key, value]) =>
      /confidence|quality|^qa_policy$|^filters$/.test(key) &&
      value != null &&
      (typeof value !== 'object' || Object.keys(value).length > 0)
  );
}
export function nativePartitionSources(p: NativePartitionScope): string[] {
  const values = p.support_spec.source_ids;
  if (Array.isArray(values)) return values.filter((v): v is string => typeof v === 'string');
  // The canonical Python publisher writes one source per daily partition.
  const source = p.support_spec.source_id;
  return typeof source === 'string' && source.length > 0 ? [source] : [];
}
export function relevantNativePartitions<T extends NativePartitionScope>(
  parts: T[],
  sources: string[],
  start: number,
  end: number
): T[] {
  const timestamp = (raw: unknown): number | null => {
    // Python's datetime.isoformat emits +00:00; it is the same UTC offset as Z.
    const v = typeof raw === 'string' ? raw.replace(/\+00:00$/, 'Z') : raw;
    if (
      typeof v !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(v)
    )
      return null;
    const value = Date.parse(v);
    return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === v.slice(0, 10)
      ? value
      : null;
  };
  return parts.filter((p) => {
    const selected = nativePartitionSources(p),
      left = timestamp(p.support_spec.start),
      right = timestamp(p.support_spec.end_exclusive);
    const bounds = left !== null && right !== null && left < right;
    return (
      (!selected.length || selected.some((s) => sources.includes(s))) &&
      (!bounds || (left! < end && right! > start))
    );
  });
}
/** Alias is a developer-owned SQL identifier, never request input. */
export function nativeAreaSql(alias: string): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('Invalid internal area alias.');
  return `CASE WHEN ST_XMax(${alias}.geom)-ST_XMin(${alias}.geom)>=359.999
    AND ST_YMax(${alias}.geom)-ST_YMin(${alias}.geom)>=179.999 THEN ${alias}.geom
    WHEN ST_XMax(${alias}.geom)-ST_XMin(${alias}.geom)>180
    THEN (SELECT ST_Collect(CASE WHEN ST_XMax(part.geom)-ST_XMin(part.geom)>180
      THEN ST_WrapX(ST_ShiftLongitude(part.geom),180,-360) ELSE part.geom END)
      FROM ST_Dump(${alias}.geom) part) ELSE ${alias}.geom END`;
}
