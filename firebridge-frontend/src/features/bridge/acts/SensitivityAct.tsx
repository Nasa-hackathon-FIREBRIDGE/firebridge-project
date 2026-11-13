import { lazy, Suspense } from 'react'
import type { SensorKey } from '../../../lib/sensors'
import type { BridgeReport, FrpDistribution } from '../engine/index.ts'
import { fmtInt, fmtShare, sensorColor, sensorLabel } from '../format'
import { Act, Legend, LegendItem, Note, Tile } from '../ui'
import { floorCheck, heavyTailCheck } from '../../science/checks'

const FrpChart = lazy(() => import('../BridgeCharts').then((m) => ({ default: m.FrpChart })))
const ResponseChart = lazy(() => import('../BridgeCharts').then((m) => ({ default: m.ResponseChart })))

export function SensitivityAct({ report, platform }: { report: BridgeReport; platform: SensorKey }) {
  const { floor, floorSample, distributions, belowFloor, curves } = report.sensitivity
  const name = sensorLabel(platform)
  const reference = distributions.find((d) => d.group === 'aqua')
  const own = distributions.find((d) => d.group === platform) as (FrpDistribution & { group: SensorKey }) | undefined
  const curve = curves.find((c) => c.platform === platform)
  const strong = curve?.bins.filter((b) => b.from >= 50 && b.rate !== null)[0]
  const weak = curve?.bins.filter((b) => b.to <= 5 && b.n > 0)
  const weakRate = weak && weak.reduce((s, b) => s + b.n, 0) ? weak.reduce((s, b) => s + b.detected, 0) / weak.reduce((s, b) => s + b.n, 0) : null
  return (
    <Act
      index={3}
      science={report.evidence ? [floorCheck(report, platform), heavyTailCheck(report)] : undefined}
      eyebrow="What MODIS can see"
      title="The detection floor, measured here"
      lede={<>Fire radiative power (FRP) is the heat a fire radiates at the moment of the pass. Comparing the two records shows directly how strong a fire must be before Aqua records it, and how often Aqua also sees what {name} sees.</>}
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Tile tone="ember" label="MODIS floor here" value={floor === null ? '—' : `${floor} MW`} sub={floor === null ? `Needs ≥ 20 Aqua daytime FRP values (${floorSample} available)` : `5th percentile of ${fmtInt(floorSample)} Aqua daytime detections`} />
        <Tile label={`${name} detections below it`} value={fmtShare(belowFloor[platform])} sub="Daytime detections weaker than the floor" />
        <Tile
          label="Aqua also detects"
          value={weakRate === null ? '—' : `${Math.round(weakRate * 100)}% → ${strong?.rate == null ? '—' : `${Math.round(strong.rate * 100)}%`}`}
          sub={`of ${name} fire cell-days below 5 MW → at 50 MW or more`}
        />
      </div>
      <div className="grid gap-8 xl:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-[13px] font-medium text-fg">Daytime FRP distribution</p>
            <Legend label="FRP distribution series">
              <LegendItem color={sensorColor('aqua')} shape="line" label="Aqua (MODIS)" />
              <LegendItem color={sensorColor(platform)} shape="line" label={`${name} (VIIRS)`} />
            </Legend>
          </div>
          {reference && own && reference.n > 0 && own.n > 0 ? (
            <Suspense fallback={<div className="ui-skeleton h-[280px] w-full" />}>
              <FrpChart reference={reference} platform={own} floor={floor} />
            </Suspense>
          ) : (
            <p className="m-0 text-[13px] text-fg-3">Both records need daytime FRP values in this selection.</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="m-0 mb-3 text-[13px] font-medium text-fg">How often Aqua also detects a {name} fire cell-day</p>
          {curve && curve.bins.some((b) => b.n > 0) ? (
            <Suspense fallback={<div className="ui-skeleton h-[260px] w-full" />}>
              <ResponseChart curve={curve} />
            </Suspense>
          ) : (
            <p className="m-0 text-[13px] text-fg-3">No paired months for {name} and Aqua.</p>
          )}
          <p className="mb-0 mt-2 text-[11.5px] text-fg-3">By {name} peak FRP in the 5 km cell. Whiskers: 90% Wilson intervals. Faded bars: fewer than 10 cell-days.</p>
        </div>
      </div>
      <Note>FRP is a radiative measurement at one instant; it is not burned area or total fire energy. The two instruments measure FRP on different pixels, so a single fire’s values are comparable only approximately.</Note>
    </Act>
  )
}
