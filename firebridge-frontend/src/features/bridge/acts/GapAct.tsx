import type { SensorKey } from '../../../lib/sensors'
import type { BridgeReport } from '../engine/index.ts'
import { fmtInt, fmtMinutes, fmtRatio, fmtShare, sensorColor, sensorLabel } from '../format'
import { Act, Legend, LegendItem, Note } from '../ui'
import { resolutionCheck } from '../../science/checks'
import { AskWhy } from '../../copilot/AskWhy'

const SEGMENTS = [
  { key: 'pixel', label: 'Pixel size', color: '#ffc5a3' },
  { key: 'smallFires', label: 'Fires below the MODIS floor', color: '#ff7c40' },
  { key: 'residual', label: 'Not explained by these two', color: '#3a404d' },
] as const

export function GapAct({ report, platform }: { report: BridgeReport; platform: SensorKey }) {
  const gap = report.sensitivity.gaps.find((g) => g.platform === platform)
  const floor = report.sensitivity.floor
  const name = sensorLabel(platform)
  const timing = report.regime.timing.filter((t) => t.platform === platform && t.n >= 3)
  const medianLag = timing.length ? timing.reduce((sum, t) => sum + t.medianMinutes * t.n, 0) / timing.reduce((sum, t) => sum + t.n, 0) : null
  if (!gap || gap.ratioDetections === null || gap.ratioCells === null)
    return (
      <Act index={1} eyebrow="The gap, decomposed" title={`Why does ${name} record more detections than Aqua?`}>
        <p className="m-0 text-[13.5px] text-fg-2">
          {report.replays.find((r) => r.platform === platform)?.driftBlocked
            ? <>{name} overlaps Aqua here only after Aqua’s overpass drifted from its original time (from {report.regime.driftYears[0]}). The gap is not decomposed against a drifted reference.</>
            : <>This needs Aqua and {name} detections in the same inventoried months. They do not overlap in this analysis, so the gap cannot be decomposed here.</>}
        </p>
      </Act>
    )
  const steps = [
    { label: 'Native detections', detail: `${fmtInt(gap.platformDetections)} ${name} vs ${fmtInt(gap.aquaDetections)} Aqua daytime detections`, ratio: gap.ratioDetections },
    { label: 'Same 5 km cell, same day', detail: `${fmtInt(gap.platformCellDays)} vs ${fmtInt(gap.aquaCellDays)} active cell-days; several 375 m pixels of one fire count once`, ratio: gap.ratioCells },
    ...(gap.ratioVisible !== null && floor !== null
      ? [{ label: `Only fires MODIS can resolve`, detail: `${fmtInt(gap.platformVisibleCellDays ?? 0)} ${name} cell-days with peak FRP ≥ ${floor} MW, the Aqua floor measured here`, ratio: gap.ratioVisible }]
      : []),
  ]
  const top = Math.log(Math.max(...steps.map((s) => s.ratio), 2))
  const width = (ratio: number) => `${Math.max(1.5, (Math.log(Math.max(ratio, 1)) / top) * 100)}%`
  const shares = gap.shares
  const decomposable = shares && shares.residual >= 0 && shares.pixel >= 0 && shares.smallFires >= 0
  return (
    <Act
      index={1}
      science={report.evidence ? [resolutionCheck(report, platform)] : undefined}
      eyebrow="The gap, decomposed"
      title={`Why ${name} records ${fmtRatio(gap.ratioDetections)} as many detections as Aqua`}
      action={<AskWhy question={`Is ${name} seeing more fire than Aqua, or just smaller fires?`} label="Ask" />}
      lede={<>Same area, same months, daytime passes only. Each step removes one known difference between the instruments; what remains is the part of the gap that the satellites alone do not explain.</>}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <ol className="m-0 flex list-none flex-col gap-5 p-0" aria-label={`${name} to Aqua ratio, step by step`}>
          {steps.map((step, index) => (
            <li key={step.label} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <span className="flex min-w-0 items-baseline gap-2.5">
                  <span className="font-mono text-[11px] text-fg-3">{index + 1}</span>
                  <span className="text-[14px] font-medium text-fg">{step.label}</span>
                </span>
                <span className="shrink-0 text-[22px] font-semibold leading-none tracking-tight text-fg">{fmtRatio(step.ratio)}</span>
              </div>
              <div className="relative h-2.5 rounded-full bg-white/[0.04]" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 origin-left animate-grow-x rounded-full" style={{ width: width(step.ratio), background: sensorColor(platform), animationDelay: `${index * 120}ms` }} />
              </div>
              <p className="m-0 text-[12.5px] text-fg-3">{step.detail}</p>
            </li>
          ))}
          <li className="text-[11.5px] text-fg-3">Bars use a log scale; the left edge is parity with Aqua (1×).</li>
        </ol>
        <div className="flex min-w-0 flex-col gap-4">
          {decomposable ? (
            <>
              <p className="m-0 text-[13.5px] leading-relaxed text-fg-2">
                Of the {fmtRatio(gap.ratioDetections)} gap (measured on a log scale),{' '}
                <strong className="font-semibold text-fg">{fmtShare(shares.pixel + shares.smallFires)}</strong> comes from how the instruments see rather than from how much burned.
              </p>
              <div className="flex h-11 gap-[2px] overflow-hidden rounded-xl" role="img" aria-label={SEGMENTS.map((s) => `${s.label} ${fmtShare(shares[s.key])}`).join(', ')}>
                {SEGMENTS.map((segment) => (
                  <span key={segment.key} className="flex h-full min-w-0 items-center justify-center text-[12px] font-semibold" style={{ width: `${shares[segment.key] * 100}%`, background: segment.color, color: segment.key === 'residual' ? '#f3f4f7' : '#1d1209' }}>
                    {shares[segment.key] >= 0.12 ? fmtShare(shares[segment.key]) : ''}
                  </span>
                ))}
              </div>
              <Legend label="Gap components">
                {SEGMENTS.map((segment) => <LegendItem key={segment.key} color={segment.color} shape="bar" label={`${segment.label} · ${fmtShare(shares[segment.key])}`} />)}
              </Legend>
              <dl className="m-0 grid gap-3 text-[12.5px] leading-relaxed text-fg-2">
                <div><dt className="inline font-medium text-fg">Pixel size. </dt><dd className="inline m-0">VIIRS I-band pixels are 375 m against MODIS’s 1 km, so one fire often lights several VIIRS pixels.</dd></div>
                <div><dt className="inline font-medium text-fg">Small fires. </dt><dd className="inline m-0">{fmtShare(report.sensitivity.belowFloor[platform])} of {name}’s daytime detections are weaker than {floor} MW, below 95% of what Aqua recorded here.</dd></div>
                <div><dt className="inline font-medium text-fg">Remainder. </dt><dd className="inline m-0">Overpass timing{medianLag !== null ? ` (${name} passes ${fmtMinutes(Math.round(medianLag))} from Aqua on shared fire days)` : ''}, swath geometry, cloud and algorithm differences. Not attributed further without fire masks.</dd></div>
              </dl>
            </>
          ) : (
            <p className="m-0 text-[13.5px] text-fg-2">The ratios cannot be split into additive shares for this selection (one step is at or below parity). The step values on the left still apply.</p>
          )}
        </div>
      </div>
      <Note>Counts are daytime, presumed-vegetation detections (FIRMS type 0) in months where both records are fully inventoried. The order of the steps is fixed; a different order would attribute the shares differently.</Note>
    </Act>
  )
}
