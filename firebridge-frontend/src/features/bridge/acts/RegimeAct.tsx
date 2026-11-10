import { lazy, Suspense } from 'react'
import { SENSORS, type SensorKey } from '../../../lib/sensors'
import type { BridgeReport } from '../engine/index.ts'
import { REFERENCE_DRIFT_MINUTES } from '../engine/index.ts'
import { fmtClock, fmtDate, fmtInt, fmtMinutes, sensorLabel } from '../format'
import { Act, Legend, LegendItem, Note, SensorDot, Tile } from '../ui'

const OverpassChart = lazy(() => import('../BridgeCharts').then((m) => ({ default: m.OverpassChart })))

export function RegimeAct({ report }: { report: BridgeReport }) {
  const { rows, drift, timing, referenceBaseline, driftYears } = report.regime
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
          Aqua passes more than {REFERENCE_DRIFT_MINUTES} min away from its early-record time ({fmtClock(referenceBaseline)}) in {driftYears.join(', ')}. Those months still use observed Aqua in the bridge, flagged as a drifted reference.
        </Note>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {timingPlatforms.length > 0 && (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12.5px]">
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
