import type { SensorKey } from '../../lib/sensors'
import { VIIRS_PLATFORMS, type BridgeReport } from './engine/index.ts'

/** Default comparison platform: the VIIRS record with the longest testable overlap with Aqua. */
export function defaultPlatform(report: BridgeReport): SensorKey | null {
  const usable = report.replays.filter((r) => r.support !== 'insufficient')
  return [...usable].sort((a, b) => b.pairedMonths - a.pairedMonths || b.platformCellDays - a.platformCellDays)[0]?.platform ?? report.platforms[0] ?? null
}

export function bridgeCsv(report: BridgeReport) {
  const platforms = VIIRS_PLATFORMS.filter((p) => report.months.some((m) => m.estimates[p]))
  const header = ['month', 'aqua_inventory', 'aqua_observed_cell_days', 'reference_drift', 'bridge_value', 'bridge_low', 'bridge_high', 'bridge_source', 'native_detections_all_sources', ...platforms.flatMap((p) => [`${p}_estimate`, `${p}_low`, `${p}_high`])]
  const n = (value: number | null | undefined) => (value == null ? '' : String(Math.round(value * 100) / 100))
  const rows = report.months.map((m) => [m.month, m.aquaState, n(m.aqua), String(m.referenceDrift), n(m.bridge?.value), n(m.bridge?.low), n(m.bridge?.high), m.bridge?.source ?? '', String(m.raw), ...platforms.flatMap((p) => [n(m.estimates[p]?.value), n(m.estimates[p]?.low), n(m.estimates[p]?.high)])])
  return [header, ...rows].map((r) => r.join(',')).join('\n') + '\n'
}

