import { SENSORS, type SensorKey } from '../../lib/sensors'

export const sensorLabel = (key: SensorKey) => SENSORS[key].label
export const sensorColor = (key: SensorKey) => SENSORS[key].color

export const fmtInt = (value: number) => Math.round(value).toLocaleString('en-US')
export const fmtRatio = (value: number | null | undefined) => (value == null ? '—' : `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}×`)
export const fmtShare = (value: number | null | undefined) => (value == null ? '—' : `${Math.round(value * 100)}%`)
export const fmtSigned = (value: number | null | undefined) => (value == null ? 'n/a' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Math.round(value * 100))}%`)
export const fmtOne = (value: number) => (Math.abs(value) >= 100 ? fmtInt(value) : value.toFixed(1))
/** Whole counts without a decimal; estimates keep one. */
export const fmtCount = (value: number) => (Number.isInteger(value) ? fmtInt(value) : fmtOne(value))

/** Hours (local solar time) as HH:MM. */
export function fmtClock(hours: number) {
  const total = Math.round((((hours % 24) + 24) % 24) * 60)
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export const fmtMinutes = (minutes: number) => `${minutes > 0 ? '+' : minutes < 0 ? '−' : '±'}${Math.abs(minutes)} min`

export function fmtMonth(month: string, style: 'short' | 'long' = 'short') {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: style, year: 'numeric', timeZone: 'UTC' })
}

export function fmtDate(iso: string) {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** 90th percentile of standardised out-of-fold errors for any model (band half-width factor). */
export function bandFactor(errors: { predicted: number; actual: number }[]) {
  const values = errors.map((e) => Math.abs(e.predicted - e.actual) / Math.sqrt(e.predicted + 1)).sort((a, b) => a - b)
  if (!values.length) return 0
  const position = (values.length - 1) * 0.9
  const lower = Math.floor(position)
  return values[lower] + (values[Math.ceil(position)] - values[lower]) * (position - lower)
}
