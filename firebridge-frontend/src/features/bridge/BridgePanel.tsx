import { useState } from 'react'
import { GitCompareArrows } from 'lucide-react'
import type { SensorKey } from '../../lib/sensors'
import { ApiError } from '../analyses/Feedback'
import { Banner } from '../../components/ui/Banner'
import type { BridgeReport } from './engine/index.ts'
import { fmtInt, fmtMinutes, fmtRatio, fmtShare, sensorLabel } from './format'
import { MAX_BRIDGE_DETECTIONS, useBridgeReport, type BridgeState } from './useBridgeReport'
import { PlatformPicker } from './ui'
import { Figures, Masthead, Standfirst } from '../story/Story'
import { Tally } from '../science/Evidence'
import { driftCheck, floorCheck, handoverCheck, heavyTailCheck, resolutionCheck, timeOfDayCheck, trendCheck } from '../science/checks'
import { alarmOutcome, defaultHandover, defaultPlatform } from './selectors'
import { GapAct } from './acts/GapAct'
import { RegimeAct } from './acts/RegimeAct'
import { SensitivityAct } from './acts/SensitivityAct'
import { ReplayAct } from './acts/ReplayAct'
import { HandoverAct } from './acts/HandoverAct'
import { BridgeAct } from './acts/BridgeAct'
import { MethodAct } from './acts/MethodAct'

export function BridgeProgress({ state }: { state: Extract<BridgeState, { status: 'loading' }> }) {
  const share = state.phase === 'computing' ? 1 : state.total ? Math.min(1, state.loaded / state.total) : 0
  return (
    <div className="card flex flex-col gap-3 p-5" role="status" aria-live="polite">
      <p className="m-0 text-[13.5px] text-fg">
        {state.phase === 'computing'
          ? 'Running the withheld-satellite experiment…'
          : `Loading every detection of this analysis${state.total ? `: ${fmtInt(state.loaded)} of ${fmtInt(state.total)}` : '…'}`}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]" aria-hidden="true">
        <div className="h-full rounded-full bg-ember-400 transition-[width] duration-500" style={{ width: `${Math.max(4, share * 100)}%` }} />
      </div>
      <p className="m-0 text-[12px] text-fg-3">All computation happens in your browser from the pinned release; nothing is sampled.</p>
    </div>
  )
}

function Headline({ report, platform }: { report: BridgeReport; platform: SensorKey | null }) {
  const gap = platform ? report.sensitivity.gaps.find((g) => g.platform === platform) : null
  const aqua = report.regime.drift.find((d) => d.sensor === 'aqua')
  const { fingerprint } = report.regime
  const handover = platform ? defaultHandover(report, platform) : null
  const outcome = handover ? alarmOutcome(handover) : null
  const explained = gap?.shares && gap.shares.residual >= 0 ? gap.shares.pixel + gap.shares.smallFires : null
  const unseen = fingerprint.inRegime.share !== null && fingerprint.drifted.share !== null ? `fires no VIIRS pass saw: ${fmtShare(fingerprint.inRegime.share)} → ${fmtShare(fingerprint.drifted.share)}` : null
  const checks = report.evidence && platform
    ? [resolutionCheck(report, platform), driftCheck(report), timeOfDayCheck(report), floorCheck(report, platform), heavyTailCheck(report), handoverCheck(report, platform), trendCheck(report)].filter((c) => c !== null)
    : []
  return (
    <section className="flex flex-col gap-8" aria-label="Lab summary">
      <Figures
        label="The lab in four numbers"
        items={[
          { label: `${platform ? sensorLabel(platform) : 'VIIRS'} vs Aqua, raw`, value: fmtRatio(gap?.ratioDetections), note: 'daytime detections in the same months' },
          { label: 'Instrument effect', value: fmtShare(explained), note: 'of that gap: pixel size and fires below the MODIS floor' },
          { label: 'Aqua overpass drift', value: aqua ? fmtMinutes(aqua.shiftMinutes) : '—', note: aqua ? `${aqua.fromYear} → ${aqua.toYear}, read from timestamps${unseen ? `; ${unseen}` : ''}` : 'needs two well-sampled years' },
          { label: 'If Aqua went dark: false alarms', value: outcome ? `${outcome.naiveFalse.length} → ${outcome.bridgedFalse.length}` : '—', note: handover ? `un-harmonized → FIREBRIDGE, switch-off rehearsed on 1 Jan ${handover.switchMonth.slice(0, 4)}` : 'needs two years of overlap before a switch' },
        ]}
      />
      {checks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="m-0 max-w-[60ch] font-serif text-[16px] italic leading-relaxed text-paper-2" style={{ fontVariationSettings: '"opsz" 18' }}>
            A lab notebook in six experiments. Each states a claim, tests it on this selection, and closes against published science: {checks.length} claims checked.
          </p>
          <Tally statuses={checks.map((c) => c.status)} />
        </div>
      )}
    </section>
  )
}

export function BridgePanel({ analysisId, releaseId }: { analysisId?: string; releaseId?: string }) {
  const state = useBridgeReport(analysisId)
  const [picked, setPicked] = useState<{ report: BridgeReport; platform: SensorKey } | null>(null)
  if (!analysisId) return null
  const report = state.status === 'ready' ? state.report : null
  const platform = report ? (picked?.report === report ? picked.platform : defaultPlatform(report)) : null
  const gap = report && platform ? report.sensitivity.gaps.find((g) => g.platform === platform) : null
  const explained = gap?.shares && gap.shares.residual >= 0 ? gap.shares.pixel + gap.shares.smallFires : null
  return (
    <section className="flex flex-col gap-14 font-sans" aria-labelledby="bridge-heading">
      <header className="relative flex flex-col gap-6 pt-6 sm:pt-10">
        <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-ember-500/[0.07] blur-[100px]" aria-hidden="true" />
        <Masthead>
          <GitCompareArrows size={13} aria-hidden="true" /> Sensor bridge · harmonization lab{report ? ` · ${report.meta.engine}` : ''}
        </Masthead>
        <h2 id="bridge-heading" className="m-0 max-w-[20ch] font-serif text-[clamp(34px,4.6vw,62px)] font-[480] leading-[1.02] tracking-[-0.032em] text-paper" style={{ fontVariationSettings: '"opsz" 144' }}>How much of the difference is the satellite?</h2>
        <Standfirst>
          {gap?.ratioDetections && platform ? (
            <p className="m-0">
              Here {sensorLabel(platform)} records <strong>{fmtRatio(gap.ratioDetections)}</strong> as many fire detections as Aqua over the same ground and months.{explained !== null ? <> <strong>{fmtShare(explained)}</strong> of that gap is the instrument, not the fire.</> : null} This notebook separates the two, hides Aqua and predicts it, rehearses the day Aqua goes dark, and checks every step against published science.
            </p>
          ) : (
            <p className="m-0">A detection count changes when the fire changes, but also when the sensor, its pixel size or its overpass time changes. This notebook separates the two for your exact selection, tests a common Aqua-equivalent scale against the real Aqua record, and shows where it fails.</p>
          )}
        </Standfirst>
        {report && platform && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg-3">Compare Aqua with</span>
            <PlatformPicker platforms={report.platforms} value={platform} onChange={(value) => setPicked({ report, platform: value })} />
          </div>
        )}
      </header>
      {state.status === 'loading' && <BridgeProgress state={state} />}
      {state.status === 'error' && <ApiError context="analysis" error={state.error} retry={state.retry} />}
      {state.status === 'too-large' && (
        <Banner tone="warning">
          This analysis holds {fmtInt(state.total)} detections, above the {fmtInt(MAX_BRIDGE_DETECTIONS)} the in-browser harmonization lab processes. Narrow the area or period to run it.
        </Banner>
      )}
      {report && !report.platforms.length && (
        <Banner tone="info">No VIIRS record is inventoried in this window, so there is nothing to bridge to Aqua. The lab needs Aqua and at least one of S-NPP, NOAA-20 or NOAA-21.</Banner>
      )}
      {report && (
        <>
          <Headline report={report} platform={platform} />
          {platform && <GapAct report={report} platform={platform} />}
          <RegimeAct report={report} />
          {platform && <SensitivityAct report={report} platform={platform} />}
          {platform && <ReplayAct report={report} platform={platform} />}
          {platform && <HandoverAct report={report} platform={platform} />}
          <BridgeAct report={report} />
          <MethodAct report={report} analysisId={analysisId} releaseId={releaseId} />
        </>
      )}
    </section>
  )
}
