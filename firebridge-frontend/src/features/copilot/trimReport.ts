import type { BridgeReport } from '../bridge/engine/index.ts'

/** The sensor-bridge report as the explainer agent reads it: the browser already computed it,
 *  so the agent receives the findings instead of recomputing them. Bulky per-detection and
 *  per-fold detail is dropped (about 1.6 MB → 200 KB for nine years). */
export function explainerReport(report: BridgeReport, analysisId: string, releaseId?: string) {
  return {
    analysis_id: analysisId,
    release_id: releaseId ?? null,
    report: {
      meta: report.meta,
      sensitivity: { floor: report.sensitivity.floor },
      headline: report.headline,
      years: report.years,
      driftEffect: report.driftEffect,
      months: report.months.map(({ month, aqua, aquaState, referenceDrift, bridge, raw, rawBySensor }) => ({ month, aqua, aquaState, referenceDrift, bridge, raw, rawBySensor })),
      regime: { drift: report.regime.drift, orbits: report.regime.orbits, fingerprint: report.regime.fingerprint, referenceBaseline: report.regime.referenceBaseline, driftYears: report.regime.driftYears },
      replays: report.replays.map(({ months: _months, final: _final, ...rest }) => rest),
      handovers: report.handovers.map(({ months: _months, ...rest }) => rest),
      anomalies: report.anomalies,
      episodes: { ...report.episodes, all: undefined },
      evidence: report.evidence && trimEvidence(report),
    },
  }
}

/** The independent checks, without the per-cell map: only months that are flagged or burned
 *  unusually hot, and the place statistics without the cells themselves. */
function trimEvidence(report: BridgeReport) {
  const { evidence, anomalies } = report
  const flagged = new Set(anomalies.months.filter((a) => a.kind).map((a) => a.month))
  return {
    ...evidence,
    places: evidence.places && { ...evidence.places, cells: undefined },
    months: evidence.months.filter((m) => flagged.has(m.month) || (m.energy && Math.abs(m.energy.z) >= anomalies.threshold)),
  }
}
