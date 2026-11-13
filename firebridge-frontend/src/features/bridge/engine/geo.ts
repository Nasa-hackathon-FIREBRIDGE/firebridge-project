/**
 * Equal-area analysis grid: EASE-Grid 2.0 global projection (EPSG:6933), a Lambert
 * cylindrical equal-area projection on the WGS 84 ellipsoid with standard parallel 30°.
 * Square cells in these metres have equal ground area everywhere, so a "5 km cell" is
 * the same 25 km² support for every sensor, latitude and year.
 */
const A = 6378137
const E2 = 0.0066943799901413165
const E = Math.sqrt(E2)
const STANDARD_PARALLEL = (30 * Math.PI) / 180
const K0 = Math.cos(STANDARD_PARALLEL) / Math.sqrt(1 - E2 * Math.sin(STANDARD_PARALLEL) ** 2)
const RAD = Math.PI / 180

/** Authalic q(φ) for sin(φ); Snyder (1987) eq. 3-12. */
function authalicQ(sinPhi: number) {
  return (1 - E2) * (sinPhi / (1 - E2 * sinPhi * sinPhi) - (1 / (2 * E)) * Math.log((1 - E * sinPhi) / (1 + E * sinPhi)))
}

export const GRID_CRS = 'EPSG:6933'

/** Forward projection to EASE-Grid 2.0 metres. */
export function toEase2(lon: number, lat: number): [number, number] {
  const clamped = Math.max(-89.999999, Math.min(89.999999, lat))
  return [A * K0 * lon * RAD, (A * authalicQ(Math.sin(clamped * RAD))) / (2 * K0)]
}

/** Integer cell index for projected metres. */
export function cellIndex(x: number, y: number, size: number): [number, number] {
  return [Math.floor(x / size), Math.floor(y / size)]
}

/** Great-circle-free planar distance in metres between two projected points.
 *  Equal-area projections are not conformal; at the ~2 km linking scale used here the
 *  shape distortion is small within ±60° latitude, and the linking radius is documented. */
export function planarDistance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by)
}
