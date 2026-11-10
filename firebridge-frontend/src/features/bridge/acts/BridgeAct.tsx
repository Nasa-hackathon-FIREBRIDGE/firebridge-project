import { lazy, Suspense, useMemo, useState } from 'react'
import type { SensorKey } from '../../../lib/sensors'
import { compareYears, type BridgeReport, type YearComparison } from '../engine/index.ts'
import { fmtInt, fmtOne, fmtSigned, sensorColor, sensorLabel } from '../format'
import { Act, Legend, LegendItem, Note, Tile } from '../ui'
import type { IndexedSeries } from '../BridgeCharts'

const IndexedYearsChart = lazy(() => import('../BridgeCharts').then((m) => ({ default: m.IndexedYearsChart })))
const MonthlyBridgeChart = lazy(() => import('../BridgeCharts').then((m) => ({ default: m.MonthlyBridgeChart })))
const EMBER = '#ff7c40'
const NEUTRAL = '#8b93a3'
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const isFull = (report: BridgeReport, year: string) => {
  const y = report.years.find((x) => x.year === year)
  return !!y && y.monthsInWindow === 12 && y.monthsBridged === 12
}

/** The year pair where the changing satellite fleet distorts the raw total most: the largest
 *  gap between the all-satellite change and the same-sensor change (a sign flip counts extra). */
function mostDistorted(report: BridgeReport): [string, string] | null {
  const years = report.years.filter((y) => isFull(report, y.year)).map((y) => y.year)
  let best: { pair: [string, string]; score: number } | null = null
  for (let i = 0; i < years.length; i++)
    for (let j = i + 1; j < years.length; j++) {
      const c = compareYears(report, years[i], years[j])
      if (c.raw.change === null || !c.constant || c.constant.change === null) continue
      const score = Math.abs(c.raw.change - c.constant.change) + (Math.sign(c.raw.change) !== Math.sign(c.constant.change) ? 0.5 : 0)
      if (!best || score > best.score) best = { pair: [years[i], years[j]], score }
    }
  return best?.pair ?? null
}

function monthSpan(months: string[]) {
  if (months.length === 12) return 'full calendar year'
  if (!months.length) return 'no common months'
  return months.length > 3 ? `${MONTH_NAMES[Number(months[0]) - 1]}–${MONTH_NAMES[Number(months[months.length - 1]) - 1]} (${months.length} months)` : months.map((m) => MONTH_NAMES[Number(m) - 1]).join(', ')
}

function Comparison({ report, comparison }: { report: BridgeReport; comparison: YearComparison }) {
  const { a, b, raw, constant, bridge, constantSensor } = comparison
  const byMonth = new Map(report.months.map((m) => [m.month, m]))
  const sensorTotal = (year: string, sensor: SensorKey) => comparison.months.reduce((sum, mm) => sum + (byMonth.get(`${year}-${mm}`)?.rawBySensor[sensor] ?? 0), 0)
  const added = (['terra', 'aqua', 'snpp', 'noaa20', 'noaa21', 'landsat'] as SensorKey[]).filter((s) => sensorTotal(b, s) > 0 && sensorTotal(a, s) === 0)
  const removed = (['terra', 'aqua', 'snpp', 'noaa20', 'noaa21', 'landsat'] as SensorKey[]).filter((s) => sensorTotal(a, s) > 0 && sensorTotal(b, s) === 0)
  // Fleet effect: same instrument held fixed, so any gap to the raw total is the satellite mix.
  const fleet = raw.change !== null && constant?.change != null ? { raw: raw.change, same: constant.change, flips: Math.sign(raw.change) !== Math.sign(constant.change) } : null
  const fleetMatters = fleet && (fleet.flips || Math.abs(fleet.raw - fleet.same) > 0.1)
  // Fire-size effect: VIIRS resolves small fires, the Aqua-equivalent scale mostly larger ones.
  const size = constant?.change != null && bridge?.change != null ? { viirs: constant.change, aqua: bridge.change } : null
  // An estimated year carries an error range: the fire-size reading needs that range to exclude the same-sensor change.
  const separated = !!size && (bridge!.observed || (!!bridge!.range && (size.viirs < bridge!.range[0] || size.viirs > bridge!.range[1])))
  const sizeMatters = size && separated && Math.abs(Math.log1p(size.aqua) - Math.log1p(size.viirs)) > Math.log(1.25)
  const sizeUnresolved = size && !separated && Math.abs(Math.log1p(size.aqua) - Math.log1p(size.viirs)) > Math.log(1.25)
  const drifted = [a, b].filter((year) => comparison.months.some((mm) => byMonth.get(`${year}-${mm}`)?.referenceDrift))
  const verb = (change: number) => (change >= 0 ? 'rises' : 'falls')
  const magnitude = (change: number) => fmtSigned(change).replace(/^[+−±]/, '')
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Tile label="All satellites, raw detections" value={fmtSigned(raw.change)} sub={`${fmtInt(raw.a)} → ${fmtInt(raw.b)} native detections`} />
        <Tile
          label={constantSensor ? `${sensorLabel(constantSensor)} only, same sensor` : 'One constant sensor'}
          value={constant ? fmtSigned(constant.change) : '—'}
          sub={constant ? `${fmtInt(constant.a)} → ${fmtInt(constant.b)} detections` : 'No sensor is inventoried throughout both periods'}
        />
        <Tile
          tone="ember"
          label="Aqua-equivalent (bridge)"
          value={bridge ? fmtSigned(bridge.change) : '—'}
          sub={
            bridge
              ? `${fmtOne(bridge.a.value)} → ${fmtOne(bridge.b.value)} active cell-days${bridge.observed ? ' · observed Aqua' : bridge.range ? ` · range ${fmtSigned(bridge.range[0])} to ${fmtSigned(bridge.range[1])}` : ''}`
              : 'No supported record in these months'
          }
        />
      </div>
      <div className="mt-4 flex flex-col gap-2 text-[13.5px] leading-relaxed text-fg-2">
        <p className="m-0">Compared over the {monthSpan(comparison.months)} available in both years.</p>
        {fleet && fleetMatters && (
          <p className="m-0">
            <strong className="font-semibold text-fg">{fleet.flips ? 'The raw total points the wrong way.' : 'The raw total is distorted by the satellite fleet.'}</strong> It {verb(fleet.raw)} {magnitude(fleet.raw)}, while the same sensor ({sensorLabel(constantSensor!)}) {verb(fleet.same)} {magnitude(fleet.same)}.
            {added.length > 0 && <> {added.map(sensorLabel).join(' and ')} contribute{added.length === 1 ? 's' : ''} {fmtInt(added.reduce((sum, k) => sum + sensorTotal(b, k), 0))} detections in {b} and none in {a}.</>}
            {removed.length > 0 && <> {removed.map(sensorLabel).join(' and ')} {removed.length === 1 ? 'contributes' : 'contribute'} to {a} but not to {b}.</>}
          </p>
        )}
        {fleet && !fleetMatters && <p className="m-0">The raw total and the same-sensor record agree here ({fmtSigned(fleet.raw)} vs {fmtSigned(fleet.same)}); the satellite fleet does not distort this comparison much.</p>}
        {size && sizeMatters && (
          <p className="m-0">
            <strong className="font-semibold text-fg">{size.aqua > size.viirs ? 'The change is concentrated in larger fires.' : 'The change is concentrated in smaller fires.'}</strong> Activity at Aqua’s scale, which mostly resolves fires above its detection floor, changes {fmtSigned(size.aqua)}, against {fmtSigned(size.viirs)} for {sensorLabel(constantSensor!)} detections, which include many small fires.
          </p>
        )}
        {sizeUnresolved && bridge?.range && (
          <p className="m-0">
            At Aqua’s scale the change is {fmtSigned(size!.aqua)}, but part of it is estimated from VIIRS with a range of {fmtSigned(bridge.range[0])} to {fmtSigned(bridge.range[1])}, which includes the {fmtSigned(size!.viirs)} {sensorLabel(constantSensor!)} change. The two cannot be told apart here.
          </p>
        )}
        {bridge && drifted.length > 0 && (
          <p className="m-0 text-[12.5px] text-fg-3">
            Aqua’s overpass in {drifted.join(' and ')} had drifted more than 30 min from its original time, so those months are estimated from VIIRS as Aqua would have recorded at its original time, not taken from the drifted pass.
          </p>
        )}
      </div>
    </>
  )
}

export function BridgeAct({ report }: { report: BridgeReport }) {
  const fullYears = useMemo(() => report.years.filter((y) => isFull(report, y.year)).map((y) => y.year), [report])
  const years = report.years.filter((y) => y.bridge).map((y) => y.year)
  const initial = useMemo(() => mostDistorted(report), [report])
  const [pair, setPair] = useState<{ report: BridgeReport; a: string; b: string } | null>(null)
  const selected = pair?.report === report ? pair : initial ? { report, a: initial[0], b: initial[1] } : years.length >= 2 ? { report, a: years[0], b: years[years.length - 1] } : null
  const [yearA, yearB] = [selected?.a, selected?.b]
  const comparison = useMemo(() => (yearA && yearB ? compareYears(report, yearA, yearB) : null), [report, yearA, yearB])

  const indexed = useMemo(() => {
    if (fullYears.length < 2) return null
    const byYear = new Map(report.years.map((y) => [y.year, y]))
    const state = (sensor: SensorKey, month: string) => report.availability.bySensor[sensor]?.[month]
    const constant = (['snpp', 'noaa20', 'aqua', 'terra'] as SensorKey[]).find((s) => fullYears.every((year) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).every((m) => state(s, m) === 'complete')))
    const base = byYear.get(fullYears[0])!
    const index = (value: number | null | undefined, reference: number | null | undefined) => (value == null || !reference ? null : (value / reference) * 100)
    const series: IndexedSeries[] = [
      { id: 'raw', name: 'All satellites (native detections)', color: NEUTRAL, values: fullYears.map((y) => index(byYear.get(y)!.raw, base.raw)) },
      ...(constant ? [{ id: 'constant' as const, name: `${sensorLabel(constant)} only (detections)`, color: sensorColor(constant), values: fullYears.map((y) => index(byYear.get(y)!.rawBySensor[constant], base.rawBySensor[constant])) }] : []),
      {
        id: 'bridge',
        name: 'Aqua-equivalent (bridge)',
        color: EMBER,
        values: fullYears.map((y) => index(byYear.get(y)!.bridge?.value, base.bridge?.value)),
        low: fullYears.map((y) => index(byYear.get(y)!.bridge?.low, base.bridge?.value)),
        high: fullYears.map((y) => index(byYear.get(y)!.bridge?.high, base.bridge?.value)),
      },
    ]
    const events = new Map<string, string[]>()
    for (const event of report.availability.events) {
      // A change dated in the last fortnight of a year (e.g. a 31 Dec collection switch) takes effect in the next.
      const year = new Date(Date.parse(`${event.date}T00:00:00Z`) + 15 * 86_400_000).toISOString().slice(0, 4)
      if (event.kind === 'horizon' || !fullYears.includes(year) || year === fullYears[0]) continue
      const short = event.kind === 'collection' ? event.label.replace(/ (MODIS|VIIRS) /, ' ') : event.label.replace(' record begins', ' joins').replace(' record ends in this archive', ' ends')
      events.set(year, [...(events.get(year) ?? []), short])
    }
    const merged = [...events].map(([year, labels]) => ({ year, label: labels.join(' · ').replace(/(Aqua C6 → C6\.1) · Terra C6 → C6\.1/, 'MODIS C6 → C6.1') }))
    return { series, events: merged, constant }
  }, [report, fullYears])

  const observed = report.months.filter((m) => m.bridge?.source === 'aqua').length
  const asFlown = report.months.filter((m) => m.referenceDrift && m.bridge && m.bridge.source !== 'aqua').length
  const estimated = report.months.filter((m) => m.bridge && m.bridge.source !== 'aqua').length
  const missing = report.months.filter((m) => !m.bridge).length
  return (
    <Act
      index={6}
      id="sensor-bridge-record"
      eyebrow="The bridge"
      title="One comparable record across changing satellites"
      lede={<>The harmonized unit is the <strong className="font-semibold text-fg">Aqua-equivalent active cell-day</strong>: a 5 km equal-area cell in which the Aqua reference reports at least one daytime fire detection that day. Observed Aqua is used wherever it flew in its original overpass regime; where it has no record or a drifted pass, the best-scoring VIIRS model from the experiment estimates it, with its empirical error range.</>}
    >
      {comparison && years.length >= 2 && (
        <div className="mb-8">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
            <span>Compare</span>
            <label className="sr-only" htmlFor="bridge-year-a">First year</label>
            <select id="bridge-year-a" className="!min-h-0 !w-auto rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1.5 text-fg" value={selected!.a} onChange={(e) => setPair({ report, a: e.target.value, b: selected!.b })}>
              {years.map((y) => <option key={y} value={y} disabled={y === selected!.b}>{y}</option>)}
            </select>
            <span>with</span>
            <label className="sr-only" htmlFor="bridge-year-b">Second year</label>
            <select id="bridge-year-b" className="!min-h-0 !w-auto rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1.5 text-fg" value={selected!.b} onChange={(e) => setPair({ report, a: selected!.a, b: e.target.value })}>
              {years.map((y) => <option key={y} value={y} disabled={y === selected!.a}>{y}</option>)}
            </select>
            {initial && pair?.report !== report && <span className="text-[12px] text-fg-3">· pre-selected: the pair where the satellite fleet distorts raw totals most</span>}
          </div>
          <Comparison report={report} comparison={comparison} />
        </div>
      )}

      {indexed && (
        <div className="mb-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-[13px] font-medium text-fg">Year-to-year, indexed ({fullYears[0]} = 100 on each scale)</p>
            <Legend label="Indexed series">
              {indexed.series.map((s) => <LegendItem key={s.id} color={s.color} shape="line" label={s.name} />)}
            </Legend>
          </div>
          <Suspense fallback={<div className="ui-skeleton h-[320px] w-full" />}>
            <IndexedYearsChart years={fullYears} series={indexed.series} events={indexed.events} />
          </Suspense>
          <p className="mb-0 mt-2 text-[11.5px] text-fg-3">Complete calendar years only. Vertical rules mark changes in the observing system. Each line is divided by its own {fullYears[0]} value, so different units share one axis.</p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-medium text-fg">Monthly Aqua-equivalent activity</p>
        <Legend label="Monthly bridge series">
          <LegendItem color={sensorColor('aqua')} shape="bar" label={`Observed Aqua · ${observed} mo`} />
          {report.months.some((m) => m.referenceDrift && m.bridge?.source === 'aqua') && <LegendItem color="rgba(56,198,244,0.45)" shape="bar" label="Observed, drifted pass (no estimate)" />}
          {asFlown > 0 && <LegendItem color={sensorColor('aqua')} label={`Aqua as flown, drifted pass · ${asFlown} mo`} muted />}
          <LegendItem color={EMBER} shape="bar" label={`VIIRS-estimated · ${estimated} mo`} />
          {missing > 0 && <LegendItem color="rgba(255,255,255,0.12)" shape="bar" label={`No supported record · ${missing} mo`} muted />}
        </Legend>
      </div>
      <Suspense fallback={<div className="ui-skeleton h-[260px] w-full" />}>
        <MonthlyBridgeChart months={report.months} platformLabel={sensorLabel} />
      </Suspense>
      {years.length < 2 && <Note>Year-to-year comparison needs a multi-year analysis. Request the same area over several years (up to ten) to compare years on the Aqua-equivalent scale.</Note>}
      <Note>
        An Aqua-equivalent cell-day is a reference convention, not ground truth: it estimates what Aqua would report, not how many fires burned. Months without any inventoried record stay empty; they are never filled with zeros.
      </Note>
    </Act>
  )
}
