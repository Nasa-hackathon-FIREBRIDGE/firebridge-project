import { lazy, Suspense } from 'react'
import { SENSORS, type SensorKey } from '../../../lib/sensors'
import type { BridgeReport } from '../engine/index.ts'
import { REFERENCE_DRIFT_MINUTES } from '../engine/index.ts'
import { fmtClock, fmtDate, fmtInt, fmtMinutes, fmtOne, sensorLabel } from '../format'
import { Act, Legend, LegendItem, Note, SensorDot, TABLE, Tile } from '../ui'
import { driftCheck, timeOfDayCheck } from '../../science/checks'
import { AskWhy } from '../../copilot/AskWhy'

const OverpassChart = lazy(() => import('../BridgeCharts').then((m) => ({ default: m.OverpassChart })))
const FingerprintChart = lazy(() => import('../BridgeCharts').then((m) => ({ default: m.FingerprintChart })))
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)

export function RegimeAct({ report }: { report: BridgeReport }) {
  const { rows, drift, timing, referenceBaseline, driftYears, orbits, fingerprint } = report.regime
  const aquaOrbit = orbits.find((o) => o.sensor === 'aqua')
  const effect = report.driftEffect
  const span = (years: string[]) => (years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0] ?? '')
  const originalYears = fingerprint.years.filter((y) => !y.drifted).map((y) => y.year)
  const driftedYears = fingerprint.years.filter((y) => y.drifted).map((y) => y.year)
  const years = [...new Set(rows.filter((r) => r.pass === 'day').map((r) => r.year))].sort()
  const aquaDrift = drift.find((d) => d.sensor === 'aqua')
  const terraDrift = drift.find((d) => d.sensor === 'terra')
  const viirs = drift.filter((d) => SENSORS[d.sensor].instrument === 'VIIRS')
  const viirsSpread = viirs.length ? Math.max(...viirs.map((d) => Math.abs(d.shiftMinutes))) : null
  const timingYears = [...new Set(timing.map((t) => t.year))].sort()
  const timingPlatforms = [...new Set(timing.map((t) => t.platform))]
  const events = report.availability.events
  return (
    <Act
      index={2}
      science={report.evidence ? [driftCheck(report), timeOfDayCheck(report)] : undefined}
      eyebrow="Same sky, different clocks"
      title="When each satellite actually looked"
      lede={<>Local solar time of every daytime detection, measured from the archive’s own timestamps rather than nominal orbit tables. A satellite that drifts later in the afternoon sees fires at a different stage of their daily cycle, so its counts change for reasons unrelated to burning.</>}
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Tile
          tone="ember"
          label="Aqua afternoon pass"
          value={aquaDrift ? fmtMinutes(aquaDrift.shiftMinutes) : '—'}
          sub={aquaDrift ? `${fmtClock(aquaDrift.from)} in ${aquaDrift.fromYear} → ${fmtClock(aquaDrift.to)} in ${aquaDrift.toYear}` : 'Needs two years with at least 10 Aqua daytime detections'}
        />
        <Tile label="Terra morning pass" value={terraDrift ? fmtMinutes(terraDrift.shiftMinutes) : '—'} sub={terraDrift ? `${fmtClock(terraDrift.from)} in ${terraDrift.fromYear} → ${fmtClock(terraDrift.to)} in ${terraDrift.toYear}` : 'Not enough Terra years'} />
        <Tile label="VIIRS platforms" value={viirsSpread === null ? '—' : `≤ ${viirsSpread} min`} sub={viirsSpread === null ? 'Not enough VIIRS years' : 'Largest change in any VIIRS platform’s median pass time'} />
      </div>
      {years.length >= 2 ? (
        <>
        <div className="mb-2 flex justify-end">
          <Legend label="Satellites">
            {(['terra', 'aqua', 'snpp', 'noaa20', 'noaa21'] as SensorKey[]).filter((s) => rows.some((r) => r.sensor === s)).map((s) => <LegendItem key={s} color={SENSORS[s].color} label={`${SENSORS[s].label} · ${SENSORS[s].instrument}`} />)}
          </Legend>
        </div>
        <Suspense fallback={<div className="ui-skeleton h-[300px] w-full" />}>
          <OverpassChart rows={rows} baseline={referenceBaseline} />
        </Suspense>
        </>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2" aria-label="Observed overpass times">
          {rows.filter((r) => r.pass === 'day').map((r) => (
            <li key={`${r.sensor}-${r.year}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2 text-[13px]">
              <span className="flex items-center gap-2 text-fg"><SensorDot sensor={r.sensor} />{sensorLabel(r.sensor)}</span>
              <span className="font-mono text-fg-2">{fmtClock(r.median)} <span className="text-fg-3">· n={fmtInt(r.n)}</span></span>
            </li>
          ))}
        </ul>
      )}
      {driftYears.length > 0 && referenceBaseline !== null && (
        <Note>
          From {aquaOrbit?.onset ?? driftYears[0]}, Aqua passes more than {REFERENCE_DRIFT_MINUTES} min from its original {fmtClock(referenceBaseline)} ({aquaOrbit?.baselineFrom === 'design-orbit' ? 'its design-orbit time at this latitude, as this window holds no years before the drift' : 'measured here while its orbit was still maintained, through 2021'}). Once the orbit is no longer corrected the drift does not reverse, so FIREBRIDGE keeps every year from then on out of calibration and estimates it from VIIRS as Aqua would have recorded at its original time. Aqua as flown stays visible for comparison.
        </Note>
      )}
      {driftedYears.length > 0 && fingerprint.inRegime.cellDays > 0 && (
        <div className="mt-6 grid gap-6 rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-[14px] font-semibold text-fg">What the drift changed in Aqua’s record</p>
              <AskWhy question="Why does Aqua's overpass drift matter for comparing years?" />
            </div>
            <p className="mb-0 mt-1.5 text-[13px] leading-relaxed text-fg-2">
              A pass long after VIIRS’s (about 13:30) catches fires that ignited or flared after VIIRS went by, and misses ones that had died down. The fingerprint: Aqua fire cell-days with no VIIRS detection nearby that day. Counted only in months where both records exist, so a missing record never looks like a miss.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Tile label={`Original pass · ${span(originalYears)}`} value={pct(fingerprint.inRegime.share)} sub={`${fmtInt(fingerprint.inRegime.unmatched)} of ${fmtInt(fingerprint.inRegime.cellDays)} Aqua fire cell-days${fingerprint.inRegime.interval ? ` · 90%: ${pct(fingerprint.inRegime.interval[0])}–${pct(fingerprint.inRegime.interval[1])}` : ''}`} />
              <Tile tone="ember" label={`Drifted pass · ${span(driftedYears)}`} value={pct(fingerprint.drifted.share)} sub={`${fmtInt(fingerprint.drifted.unmatched)} of ${fmtInt(fingerprint.drifted.cellDays)} Aqua fire cell-days${fingerprint.drifted.interval ? ` · 90%: ${pct(fingerprint.drifted.interval[0])}–${pct(fingerprint.drifted.interval[1])}` : ''}`} />
            </div>
            <p className="mb-0 mt-3 text-[13px] leading-relaxed text-fg-2">
              {fingerprint.distinguishable
                ? <><strong className="font-semibold text-fg">The 90% intervals do not overlap:</strong> the drift measurably changed which fires Aqua records here{fingerprint.addedInDrift.length ? `, even though ${fingerprint.addedInDrift.map(sensorLabel).join(' and ')} joined in the drifted years and made a VIIRS match more likely` : ''}.</>
                : 'The intervals overlap, so no change is established here yet.'}
              {effect && <> In total, Aqua as flown recorded {fmtInt(effect.observed)} cell-days in the drifted months; at its original time, {effect.sources.map(sensorLabel).join(' and ')} predict{effect.sources.length === 1 ? 's' : ''} {fmtOne(effect.estimate.value)} (range {fmtOne(effect.estimate.low)}–{fmtOne(effect.estimate.high)}).</>}
            </p>
          </div>
          <div className="min-w-0">
            <Suspense fallback={<div className="ui-skeleton h-[220px] w-full" />}>
              <FingerprintChart years={fingerprint.years} />
            </Suspense>
            <Legend label="Fingerprint bars">
              <LegendItem color={SENSORS.aqua.color} shape="bar" label="Original overpass" />
              <LegendItem color="#ff7c40" shape="bar" label="Drifted overpass" />
              <LegendItem color="#aab0bc" shape="line" label="90% interval" />
            </Legend>
          </div>
        </div>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {timingPlatforms.length > 0 && (
          <div className="min-w-0 overflow-x-auto">
            <table className={TABLE}>
              <caption className="mb-2 text-left text-[12.5px] font-medium text-fg">Pass separation from Aqua on shared fire days</caption>
              <thead>
                <tr className="text-fg-3 [&>th]:static [&>th]:bg-transparent [&>th]:font-sans [&>th]:text-[11.5px] [&>th]:normal-case [&>th]:tracking-normal [&>th]:text-fg-3">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Year</th>
                  {timingPlatforms.map((p) => <th key={p} scope="col" className="py-1.5 pr-3 font-medium"><span className="inline-flex items-center gap-1.5"><SensorDot sensor={p} />{sensorLabel(p)}</span></th>)}
                </tr>
              </thead>
              <tbody className="tabular-nums text-fg-2 [&_td]:whitespace-nowrap [&_td]:font-mono [&_td]:text-[12px] [&_th]:font-mono [&_th]:text-[12px]">
                {timingYears.map((year) => (
                  <tr key={year} className="border-t border-white/[0.05]">
                    <th scope="row" className="py-1.5 pr-3 font-medium text-fg">{year}</th>
                    {timingPlatforms.map((p) => {
                      const t = timing.find((x) => x.platform === p && x.year === year)
                      return <td key={p} className="py-1.5 pr-3">{t && t.n >= 3 ? <>{fmtMinutes(t.medianMinutes)} <span className="text-fg-3">({t.n})</span></> : <span className="text-fg-3">—</span>}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mb-0 mt-2 text-[11.5px] text-fg-3">Median minutes from Aqua (negative: earlier), on cell-days both recorded; sample in brackets. Pairs within 30 min are near-simultaneous.</p>
          </div>
        )}
        <div className="min-w-0">
          <p className="m-0 mb-2 text-[12.5px] font-medium text-fg">Changes in the observing system during this window</p>
          {events.length ? (
            <ol className="m-0 flex list-none flex-col gap-0 p-0">
              {events.map((event) => (
                <li key={`${event.date}-${event.label}`} className="relative flex gap-3 border-l border-white/[0.08] pb-3 pl-4 last:pb-0">
                  <span className="absolute -left-[4.5px] top-1 size-2 rounded-full bg-ember-400" aria-hidden="true" />
                  <time dateTime={event.date} className="w-24 shrink-0 font-mono text-[11.5px] text-fg-3">{fmtDate(event.date)}</time>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-fg-2">
                    {event.sensors.map((s: SensorKey) => <SensorDot key={s} sensor={s} />)}
                    {event.label}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="m-0 text-[12.5px] text-fg-3">{report.meta.availabilitySource === 'calendar' ? 'No source joins, leaves or collection changes inside this window.' : 'Inventory calendar unavailable; record changes cannot be listed.'}</p>
          )}
        </div>
      </div>
    </Act>
  )
}
