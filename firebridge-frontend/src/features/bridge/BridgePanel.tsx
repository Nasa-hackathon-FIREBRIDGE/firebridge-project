import { useState } from 'react'
import { GitCompareArrows } from 'lucide-react'
import type { SensorKey } from '../../lib/sensors'
import { ApiError } from '../analyses/Feedback'
import { Banner } from '../../components/ui/Banner'
import type { BridgeReport } from './engine/index.ts'
import { fmtInt, fmtMinutes, fmtRatio, fmtShare, sensorLabel } from './format'
import { MAX_BRIDGE_DETECTIONS, useBridgeReport, type BridgeState } from './useBridgeReport'
import { PlatformPicker, Tile } from './ui'
import { defaultPlatform } from './selectors'
import { GapAct } from './acts/GapAct'
import { RegimeAct } from './acts/RegimeAct'
import { SensitivityAct } from './acts/SensitivityAct'
import { ReplayAct } from './acts/ReplayAct'
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
  const replay = platform ? report.replays.find((r) => r.platform === platform) : null
  const chosen = replay?.scores.find((s) => s.model === replay.decision.model)
  const explained = gap?.shares && gap.shares.residual >= 0 ? gap.shares.pixel + gap.shares.smallFires : null
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile tone="ember" label={`${platform ? sensorLabel(platform) : 'VIIRS'} vs Aqua, raw`} value={fmtRatio(gap?.ratioDetections)} sub="daytime detections in the same months" />
      <Tile label="Instrument effect" value={fmtShare(explained)} sub="of that gap from pixel size and fires below MODIS’s floor" />
      <Tile label="Aqua overpass drift" value={aqua ? fmtMinutes(aqua.shiftMinutes) : '—'} sub={aqua ? `${aqua.fromYear} → ${aqua.toYear}, measured from timestamps` : 'needs two well-sampled years'} />
      <Tile label="Withheld-Aqua replay" value={chosen ? `±${chosen.mae.toFixed(1)}` : '—'} sub={chosen ? `Aqua cell-days per month, ${replay!.decision.model} on ${replay!.months.length} unseen months` : 'not enough paired data'} />
    </div>
  )
}

export function BridgePanel({ analysisId, releaseId }: { analysisId?: string; releaseId?: string }) {
  const state = useBridgeReport(analysisId)
  const [picked, setPicked] = useState<{ report: BridgeReport; platform: SensorKey } | null>(null)
  if (!analysisId) return null
  const report = state.status === 'ready' ? state.report : null
  const platform = report ? (picked?.report === report ? picked.platform : defaultPlatform(report)) : null
  return (
    <section className="flex flex-col gap-6 font-sans" aria-labelledby="bridge-heading">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="m-0 mb-2 inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ember-300">
            <GitCompareArrows size={13} aria-hidden="true" /> Harmonization lab{report ? ` · ${report.meta.engine}` : ''}
          </p>
          <h2 id="bridge-heading" className="m-0 text-[26px] font-semibold tracking-tight text-fg">How much of the difference is the satellite?</h2>
          <p className="mb-0 mt-2 text-[14px] leading-relaxed text-fg-2">
            A detection count changes when the fire changes, but also when the sensor, its pixel size or its overpass time changes. This lab separates the two for your exact selection, tests a common Aqua-equivalent scale against the real Aqua record, and shows where it fails.
          </p>
        </div>
        {report && platform && (
          <div className="flex flex-col items-start gap-1.5">
            <span className="text-[11.5px] text-fg-3">Compare Aqua with</span>
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
          <BridgeAct report={report} />
          <MethodAct report={report} analysisId={analysisId} releaseId={releaseId} />
        </>
      )}
    </section>
  )
}
