import type { SensorKey } from '../../lib/sensors'
import type { BridgeReport, MonthAnomaly, TrendTest } from '../bridge/engine/index.ts'
import { attention } from '../bridge/calendar'
import { fmtClock, fmtInt, fmtMonth, fmtShare, sensorLabel } from '../bridge/format'
import { alarmOutcome, defaultHandover } from '../bridge/selectors'
import type { CheckProps, CheckStatus } from './Evidence'
import { inMediterranean, type ReferenceId } from './references'
import type { Correlation, WeatherEvidence } from './weather'

/**
 * The scientific checks, generated from one bridge report. Each returns null when this analysis
 * cannot test it, so a ledger only ever shows checks backed by data.
 */
export type CheckSpec = CheckProps & { key: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pct = (value: number) => `${Math.round(value * 100)}%`
export const fmtP = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`)
const fmtRate = (value: number | null) => (value === null ? 'n/a' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Math.round(value * 100))}% a year`)
const fmtTimes = (value: number) => `${value >= 10 ? Math.round(value) : value.toFixed(value < 2 ? 2 : 1)}×`
const fmtZ = (z: number) => `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}`
const span = (start: number, length: number) => (length === 1 ? MONTHS[start] : `${MONTHS[start]} to ${MONTHS[(start + length - 1) % 12]}`)

/** When the fire season falls, and whether every year agrees. */
export function seasonCheck(report: BridgeReport): CheckSpec | null {
  const season = report.evidence.seasonality
  if (!season) return null
  const { core, years, peakTiming } = season
  const inCore = years.filter((y) => y.inCore).length
  const med = inMediterranean(report.evidence.centroid)
  const replicated = years.length >= 3 && inCore / years.length >= 0.75
  const status: CheckStatus = !years.length ? 'open' : replicated && core.length <= 6 ? 'confirms' : 'nuance'
  const cites: ReferenceId[] = ['giglio2006', ...(med ? (['chergui2018', 'copernicus2023'] as const) : []), ...(peakTiming?.p != null ? (['zar2010'] as const) : [])]
  const summerMonths = [5, 6, 7, 8]
  const outside = med ? Array.from({ length: core.length }, (_, k) => (core.start + k) % 12).filter((m) => !summerMonths.includes(m)) : []
  return {
    key: 'season',
    status,
    claim: `Burning here follows a fire season that peaks in ${MONTHS[season.peak]}`,
    measured: (
      <>
        <strong>{pct(core.share)} of a typical year’s activity falls from {span(core.start, core.length)}</strong> ({core.length} month{core.length === 1 ? '' : 's'}, {season.series === 'harmonized' ? 'Aqua-equivalent record' : 'all-satellite record'}).{' '}
        {years.length ? (
          <>
            The peak lands in that window in <strong>{inCore} of {years.length}</strong> full years
            {peakTiming?.p != null ? <>; the yearly peaks are clustered in time (Rayleigh test, {fmtP(peakTiming.p)})</> : null}.
          </>
        ) : (
          'No full calendar year is on record to test it year by year.'
        )}
      </>
    ),
    science: (
      <>
        MODIS on Terra and Aqua agree on the month of peak burning and the length of the fire season in most of the world.
        {med ? ' In the Mediterranean, fires concentrate in the hot, dry summer; the main European season runs from June to September.' : ''}
      </>
    ),
    cites,
    further: outside.length
      ? <>The core season extends into <strong>{outside.map((m) => MONTHS[m]).join(', ')}</strong>, outside the June–September wildfire season. Detections there may come from managed burning, such as crop residues or pastures; their location on the map tells the two apart.</>
      : replicated ? <>Because the season repeats every year, a month is only called unusual against <strong>the same month in other years</strong>, never against the yearly average.</> : undefined,
  }
}

/** Morning against afternoon, same instrument: the daily fire cycle. */
export function timeOfDayCheck(report: BridgeReport): CheckSpec | null {
  const a = report.evidence.timeOfDay.afternoon
  if (!a) return null
  const status: CheckStatus = a.ratio > 1.05 ? 'confirms' : a.ratio >= 0.95 ? 'nuance' : 'contradicts'
  const viirs = report.evidence.timeOfDay.daytime.find((d) => d.instrument === 'VIIRS')
  return {
    key: 'time-of-day',
    status,
    claim: 'Fires burn hardest in the afternoon, so the hour of the pass changes the count',
    measured: (
      <>
        Over {a.months} months in which both satellites flew their original orbits, Aqua’s {a.aquaClock !== null ? fmtClock(a.aquaClock) : 'afternoon'} pass recorded <strong>{fmtTimes(a.ratio)} as many detections</strong> as Terra’s {a.terraClock !== null ? fmtClock(a.terraClock) : 'morning'} pass ({fmtInt(a.aqua)} against {fmtInt(a.terra)}). Same MODIS instrument, same 1 km pixels: only the hour differs.
        {viirs ? <> VIIRS records {pct(viirs.share)} of its detections on daytime passes.</> : null}
      </>
    ),
    science: <>In 15 tropical and subtropical regions, burning peaks between 13:00 and 18:30 local time; MODIS on Terra and Aqua shows the same strong daily cycle.</>,
    cites: ['giglio2007', 'giglio2006'],
    further: <>The same curve explains Aqua’s drift: a later pass meets fires at another point of their day, changing counts while burning stays the same. Drifted years are therefore never used to calibrate the bridge.</>,
  }
}

/** VIIRS sees smaller fires; its extra detections are not extra burning. */
export function resolutionCheck(report: BridgeReport, platform?: SensorKey | null): CheckSpec | null {
  const modis = report.evidence.intensity.groups.find((g) => g.instrument === 'MODIS')
  const viirs = report.evidence.intensity.groups.find((g) => g.instrument === 'VIIRS')
  if (!modis || !viirs) return null
  const gap = (platform ? report.sensitivity.gaps.find((g) => g.platform === platform) : null) ?? report.headline
  const explained = gap?.shares && gap.shares.residual >= 0 ? gap.shares.pixel + gap.shares.smallFires : null
  return {
    key: 'resolution',
    status: viirs.medianFrp < modis.medianFrp ? 'confirms' : 'contradicts',
    claim: 'VIIRS’s extra detections are smaller fires, not more fire',
    measured: (
      <>
        The median VIIRS detection radiates <strong>{viirs.medianFrp.toFixed(1)} MW</strong>, against {modis.medianFrp.toFixed(1)} MW for MODIS (daytime passes).
        {gap && explained !== null ? <> Pixel size and fires below the MODIS floor explain <strong>{fmtShare(explained)}</strong> of the gap between {sensorLabel(gap.platform)} and Aqua.</> : null}
      </>
    ),
    science: <>The 375 m VIIRS channels resolve smaller and cooler fires than 1 km MODIS. MODIS routinely detects flaming fires of about 1,000 m², and fires a tenth of that size only in very good conditions.</>,
    cites: ['schroeder2014', 'modisGuide'],
    further: <>A raw all-satellite total therefore jumps whenever a VIIRS satellite joins the fleet. That jump measures the fleet, not the fire, and it is what the bridge removes.</>,
  }
}

/** Heavy tails: a few large fires dominate. */
export function heavyTailCheck(report: BridgeReport): CheckSpec | null {
  const { groups, clusters } = report.evidence.intensity
  const g = groups.find((x) => x.instrument === 'VIIRS') ?? groups[0]
  if (!g && !clusters) return null
  const top = Math.max(g?.topTenthShare ?? 0, clusters?.topTenthShare ?? 0)
  return {
    key: 'heavy-tail',
    status: top >= 0.3 ? 'confirms' : 'nuance',
    claim: 'A few large fires carry most of the burning',
    measured: (
      <>
        {g ? <>The strongest tenth of {g.instrument} detections releases <strong>{pct(g.topTenthShare)} of the radiated power</strong>. </> : null}
        {clusters ? <>The largest tenth of the {fmtInt(clusters.count)} detection clusters holds <strong>{pct(clusters.topTenthShare)} of all detections</strong>.</> : null}
      </>
    ),
    science: <>Wildfire sizes follow heavy-tailed, power-law-like distributions: many small fires and a few large ones that dominate the total.</>,
    cites: ['malamud1998'],
    further: <>One large fire can swing a monthly total on its own. That is why a month is only called unusual when <strong>independent satellites agree</strong>, not when one total spikes.</>,
  }
}

function trendLine(label: string, t: TrendTest) {
  return (
    <li key={label} className="flex flex-wrap justify-between gap-x-3">
      <span>{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-fg">{fmtRate(t.relativeSlope)} · {fmtP(t.p)}</span>
    </li>
  )
}

/** Trend of the harmonized record against one unchanging satellite and the raw total. */
export function trendCheck(report: BridgeReport): CheckSpec | null {
  const { raw, constant, harmonized, years } = report.evidence.trends
  if (!harmonized && !raw) return null
  const reference = harmonized ?? raw!
  const significant = (t: TrendTest | null) => !!t && t.p < 0.05
  let status: CheckStatus = 'open'
  if (harmonized && constant) status = Math.sign(harmonized.slope) === Math.sign(constant.slope) || (!significant(harmonized) && !significant(constant)) ? 'confirms' : 'nuance'
  const rawDiffers = raw && harmonized && (significant(raw) !== significant(harmonized) || (significant(raw) && Math.sign(raw.slope) !== Math.sign(harmonized.slope)))
  const verdict = significant(reference)
    ? `a ${reference.slope > 0 ? 'rising' : 'falling'} trend of ${fmtRate(reference.relativeSlope)}`
    : 'no trend distinguishable from year-to-year variation'
  return {
    key: 'trend',
    status,
    claim: harmonized && constant ? 'The harmonized record trends like a single unchanging satellite' : 'Year-to-year trend, tested without assuming a distribution',
    measured: (
      <>
        Over {years.length} full years ({years[0]}–{years[years.length - 1]}), the {harmonized ? 'Aqua-equivalent' : 'all-satellite'} record shows <strong>{verdict}</strong>.
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {raw && trendLine('All satellites, raw total', raw)}
          {constant && trendLine(`${sensorLabel(constant.sensor)} alone`, constant)}
          {harmonized && trendLine('FIREBRIDGE, Aqua-equivalent', harmonized)}
        </ul>
      </>
    ),
    science: <>The Mann–Kendall test asks whether later years rank systematically above earlier ones; Sen’s slope is the median of all year-to-year slopes. Both are standard for short environmental series. p-values here are exact.</>,
    cites: ['mann1945', 'kendall1975', 'sen1968'],
    further: rawDiffers
      ? <>The raw all-satellite total tells a different story ({fmtRate(raw!.relativeSlope)}, {fmtP(raw!.p)}): its trend comes from the changing fleet, not from the fire.</>
      : years.length < 10
        ? <>{years.length} years is short: only a strong trend could reach significance. Extending the window is the next test.</>
        : undefined,
  }
}

const sameWay = (a: MonthAnomaly, z: number) => Math.abs(z) >= 1 && Math.sign(z) === (a.kind === 'unusual-low' ? -1 : 1)

/** Unusual months, re-judged on radiated energy and burned extent. */
export function confirmationCheck(report: BridgeReport): CheckSpec | null {
  const { unusual } = attention(report)
  const scored = unusual.map((a) => ({ a, e: report.evidence.months.find((m) => m.month === a.month) })).filter((x) => x.e && (x.e.energy || x.e.extent))
  if (!scored.length) return null
  const energy = scored.filter((x) => x.e!.energy && sameWay(x.a, x.e!.energy.z))
  const extent = scored.filter((x) => x.e!.extent && sameWay(x.a, x.e!.extent.z))
  const either = scored.filter((x) => energy.includes(x) || extent.includes(x)).length
  const share = either / scored.length
  const top = scored[0]
  return {
    key: 'confirmation',
    status: share >= 2 / 3 ? 'confirms' : share >= 1 / 3 ? 'nuance' : 'contradicts',
    claim: 'Unusual months stand out in radiated energy and burned area too, not only in counts',
    measured: (
      <>
        Re-judging every unusual month on two other quantities, each satellite again against its own past: <strong>{energy.length} of {scored.length}</strong> are also unusual in radiated power and <strong>{extent.length} of {scored.length}</strong> in the number of 5 km cells that burned.
        {top.e!.energy ? <> {fmtMonth(top.a.month, 'long')}: energy {fmtZ(top.e!.energy.z)} spreads, extent {top.e!.extent ? fmtZ(top.e!.extent.z) : 'n/a'} spreads.</> : null}
      </>
    ),
    science: <>Radiated fire energy is proportional to the vegetation burned: in controlled burns it explained 98% of the variation in fuel consumed.</>,
    cites: ['wooster2005'],
  }
}

/** Months that burned hotter without more detections: what the counts alone miss. */
export function hotterCheck(report: BridgeReport): CheckSpec | null {
  const threshold = report.anomalies.threshold
  const hidden = report.anomalies.months
    .filter((a) => a.kind !== 'unusual-high' && a.kind !== 'unusual-low' && a.kind !== 'artifact')
    .map((a) => ({ a, e: report.evidence.months.find((m) => m.month === a.month)! }))
    .filter(({ e }) => e?.energy && e.energy.z >= threshold && e.energy.agreeing >= 2)
    .sort((x, y) => y.e.energy!.z - x.e.energy!.z)
  if (!hidden.length) return null
  const first = hidden[0]
  return {
    key: 'hotter',
    status: 'further',
    claim: hidden.length === 1 ? `${fmtMonth(first.a.month, 'long')} burned hotter than usual without more detections` : `${hidden.length} months burned hotter than usual without more detections`,
    measured: (
      <>
        In {hidden.map((h) => fmtMonth(h.a.month, 'short')).join(', ')}, the satellites’ radiated power sat <strong>{fmtZ(first.e.energy!.z)} spreads</strong> above a usual {MONTHS[Number(first.a.month.slice(5, 7)) - 1]} ({first.e.energy!.agreeing} of {first.e.energy!.n} satellites agree), while the number of fire detections did not stand out{first.a.kind === 'disputed' ? ' clearly enough to settle the verdict' : ''}.
      </>
    ),
    science: <>Because radiated energy tracks the vegetation burned, fewer but more intense fires can consume as much as many small ones.</>,
    cites: ['wooster2005'],
    further: <>Counting detections alone would miss {hidden.length === 1 ? 'this month' : 'these months'}. {hidden.length === 1 ? 'It is' : 'They are'} worth opening on the map.</>,
  }
}

/** Published false-alarm rates are far too small to create the unusual months. */
export function falseAlarmCheck(report: BridgeReport): CheckSpec | null {
  // The unusual-high month with the most detections: where false alarms would have most room.
  const candidates = attention(report)
    .unusual.filter((a) => a.kind === 'unusual-high' && a.harmonized)
    .map((a) => ({ a, e: report.evidence.months.find((m) => m.month === a.month) }))
    .filter((x) => x.e && x.e.detections > 0)
    .sort((x, y) => y.e!.detections - x.e!.detections)
  if (!candidates.length) return null
  const high = candidates[0].a
  const e = candidates[0].e!
  const falseCount = Math.max(1, Math.round(e.detections * 0.012))
  const times = high.harmonized!.usual >= 2 ? high.harmonized!.value / high.harmonized!.usual : null
  return {
    key: 'false-alarms',
    status: 'confirms',
    claim: 'False detections cannot create the unusual months',
    measured: (
      <>
        {fmtMonth(high.month, 'long')} holds {fmtInt(e.detections)} daytime fire detections{times ? <>, <strong>{fmtTimes(times)} a usual {MONTHS[Number(high.month.slice(5, 7)) - 1]}</strong> on the Aqua-equivalent scale</> : null}. At the published error rate, false alarms would account for about <strong>{fmtInt(falseCount)}</strong> of them.
        {e.highConfidence !== null ? <> {pct(e.highConfidence)} are flagged high confidence by the fire algorithms.</> : null}
      </>
    ),
    science: <>Collection 6 MODIS has a global daytime false-alarm rate of 1.2%; nominal-confidence VIIRS 375 m detections stay below 1.2%.</>,
    cites: ['giglio2016', 'schroeder2014'],
  }
}

/** Aqua's drift read from timestamps, against NASA's orbit record. */
export function driftCheck(report: BridgeReport): CheckSpec | null {
  const orbit = report.regime.orbits.find((o) => o.sensor === 'aqua')
  if (!orbit || orbit.baseline === null) return null
  const drift = report.regime.drift.find((d) => d.sensor === 'aqua')
  const terra = report.regime.drift.find((d) => d.sensor === 'terra' && Math.abs(d.shiftMinutes) >= 15)
  const windowEnd = report.meta.endExclusive.slice(0, 4)
  const onset = orbit.onset
  const status: CheckStatus = onset ? (onset >= '2022' ? 'confirms' : 'contradicts') : windowEnd > '2023' ? 'nuance' : 'open'
  return {
    key: 'drift',
    status,
    claim: 'Aqua’s drift, read from the archive’s own timestamps, matches NASA’s orbit record',
    measured: onset ? (
      <>
        Aqua’s afternoon pass here sat at <strong>{fmtClock(orbit.baseline)}</strong> while its orbit was maintained, and is outside that regime (more than 30 minutes off) from <strong>{onset}</strong>{drift ? <>; by {drift.toYear} it passes {Math.abs(drift.shiftMinutes)} minutes {drift.shiftMinutes > 0 ? 'later' : 'earlier'} than in {drift.fromYear}</> : null}.
        {terra ? <> Terra moved the other way: <strong>{Math.abs(terra.shiftMinutes)} minutes {terra.shiftMinutes < 0 ? 'earlier' : 'later'}</strong> from {terra.fromYear} to {terra.toYear}.</> : null}
      </>
    ) : (
      <>Aqua’s pass here stays within 30 minutes of its original {fmtClock(orbit.baseline)} in every well-sampled year of this window.</>
    ),
    science: <>NASA ended Aqua’s orbit maintenance in 2021; it has drifted freely since January 2022 and its equator crossing passed the 13:45 limit in February 2023. Terra drifts the other way, earlier, since February 2020.</>,
    cites: ['aquaOrbit', 'terraOrbit'],
    further: onset ? <>The onset comes from the data, not from a calendar: the bridge excludes Aqua’s years from {onset} on and estimates them from VIIRS.</> : undefined,
  }
}

/** The MODIS detection floor, measured here, against the published detection limits. */
export function floorCheck(report: BridgeReport, platform: SensorKey): CheckSpec | null {
  const floor = report.sensitivity.floor
  const below = report.sensitivity.belowFloor[platform]
  if (floor === null || below === undefined) return null
  return {
    key: 'floor',
    status: below >= 0.1 ? 'confirms' : 'nuance',
    claim: 'MODIS misses the smallest fires that VIIRS records',
    measured: (
      <>
        95% of Aqua’s daytime detections here radiate at least <strong>{floor} MW</strong>. <strong>{pct(below)}</strong> of {sensorLabel(platform)}’s daytime detections fall below that floor, mostly fires MODIS cannot see.
      </>
    ),
    science: <>MODIS routinely detects flaming fires of about 1,000 m², and a tenth of that only in very good conditions; the 375 m VIIRS product was designed to resolve smaller and cooler fires.</>,
    cites: ['modisGuide', 'schroeder2014'],
  }
}

/** The handover rehearsal is not hypothetical. */
export function handoverCheck(report: BridgeReport, platform: SensorKey): CheckSpec | null {
  const handover = defaultHandover(report, platform)
  if (!handover) return null
  const outcome = alarmOutcome(handover)
  return {
    key: 'handover',
    status: outcome.bridgedFalse.length < outcome.naiveFalse.length ? 'confirms' : outcome.bridgedFalse.length === outcome.naiveFalse.length ? 'nuance' : 'contradicts',
    claim: 'The switch from MODIS to VIIRS is happening now, and the bridge keeps the record readable through it',
    measured: (
      <>
        Rehearsed on this area with Aqua switched off on 1 January {handover.switchMonth.slice(0, 4)}: continuing with {sensorLabel(platform)}’s own count raises <strong>{outcome.naiveFalse.length} false alarm{outcome.naiveFalse.length === 1 ? '' : 's'}</strong>; FIREBRIDGE raises <strong>{outcome.bridgedFalse.length}</strong>.
      </>
    ),
    science: <>Aqua has drifted freely since 2022 and NASA’s acquisition plan for Aqua MODIS runs through August 2026: the afternoon MODIS record is ending, and VIIRS carries it on.</>,
    cites: ['aquaOrbit', 'aquaPlan'],
  }
}

/** Several VIIRS pixels light up where one MODIS pixel does. */
export function pixelCheck(report: BridgeReport, platform?: SensorKey | null): CheckSpec | null {
  const gap = (platform ? report.sensitivity.gaps.find((g) => g.platform === platform) : null) ?? report.headline ?? report.sensitivity.gaps[0]
  if (!gap || !gap.platformCellDays || !gap.aquaCellDays) return null
  const v = gap.platformDetections / gap.platformCellDays
  const a = gap.aquaDetections / gap.aquaCellDays
  return {
    key: 'pixels',
    status: v > a ? 'confirms' : 'contradicts',
    claim: 'One fire lights up more VIIRS pixels than MODIS pixels',
    measured: (
      <>
        On a 5 km cell and day where it saw fire, {sensorLabel(gap.platform)} records <strong>{v.toFixed(1)} detections</strong> on average; Aqua records {a.toFixed(1)} (daytime passes, same months).
      </>
    ),
    science: <>At nadir one 1 km MODIS pixel covers the ground of about seven 375 m VIIRS pixels ((1000 ÷ 375)² ≈ 7.1), and VIIRS maps fire fronts in finer detail.</>,
    cites: ['schroeder2014'],
    further: <>Counting burning 5 km cells instead of detections removes this effect. That is why the bridge works in cell-days.</>,
  }
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const fmtRho = (c: Correlation) => `ρ = ${c.rho >= 0 ? '' : '−'}${Math.abs(c.rho).toFixed(2)}, ${fmtP(c.p)}`

/** Fire against NASA's weather record at the same place and month. */
export function weatherCheck(report: BridgeReport, weather: WeatherEvidence | null): CheckSpec | null {
  if (!weather || (!weather.heat && !weather.dryness)) return null
  const { heat, dryness, seasonHeat, busy, quiet } = weather
  const sig = (c: Correlation | null, sign: 1 | -1) => !!c && c.p < 0.05 && Math.sign(c.rho) === sign
  const against = (c: Correlation | null, sign: 1 | -1) => !!c && c.p < 0.05 && Math.sign(c.rho) === -sign
  const status: CheckStatus = sig(heat, 1) || sig(dryness, -1) ? 'confirms' : against(heat, 1) || against(dryness, -1) ? 'contradicts' : 'nuance'
  const busyAlone = busy ? busy.months.filter((m) => !busy.matching.includes(m)) : []
  const med = inMediterranean(report.evidence.centroid)
  return {
    key: 'weather',
    status,
    claim: 'Fire follows the weather: hotter, drier months burned more',
    measured: (
      <>
        Each month’s fire anomaly against NASA’s weather at {weather.point.lat.toFixed(2)}°, {weather.point.lon.toFixed(2)}°, both relative to the same month in other years.
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {heat && <li className="flex flex-wrap justify-between gap-x-3"><span>Hotter than usual → more fire</span><span className="font-mono text-[12px] tabular-nums text-fg">{fmtRho(heat)} · {heat.n} months</span></li>}
          {dryness && <li className="flex flex-wrap justify-between gap-x-3"><span>Wetter than usual (3-month rain) → less fire</span><span className="font-mono text-[12px] tabular-nums text-fg">{fmtRho(dryness)}</span></li>}
          {seasonHeat && <li className="flex flex-wrap justify-between gap-x-3"><span>Heat, inside the fire season only</span><span className="font-mono text-[12px] tabular-nums text-fg">{fmtRho(seasonHeat)}</span></li>}
        </ul>
        {quiet?.matching.length ? <p className="m-0 mt-2">The unusually quiet months ({quiet.matching.map((m) => fmtMonth(m, 'short')).join(', ')}) were clearly cooler or wetter than usual.</p> : null}
      </>
    ),
    science: <>{med ? 'In most Mediterranean regions, summer burned area is significantly linked to drought in the same summer. ' : 'Hot, dry weather dries the fuel that fires need; in Mediterranean Europe summer burned area is significantly linked to same-summer drought. '}Weather here comes from NASA POWER’s MERRA-2 reanalysis, a grid of roughly 50 km.</>,
    cites: ['turco2017', 'nasaPower', 'gelaro2017'],
    further: busyAlone.length
      ? <><strong>{busyAlone.map((m) => fmtMonth(m, 'long')).join(', ')}</strong> burned unusually much in weather that was neither clearly hot nor dry. When the weather does not explain a fire burst, people usually do: {busyAlone.length === 1 ? 'that month is' : 'those months are'} the first to check for managed or agricultural burning.</>
      : <>Weather explains part of the year-to-year variation, not all of it: fire also needs fuel and an ignition, and people supply most ignitions.</>,
  }
}

/** Do the verdicts survive a stricter threshold and a withheld satellite? */
export function robustnessCheck(report: BridgeReport): CheckSpec | null {
  const list = report.evidence.robustness?.filter((r) => r.kind === 'unusual-high' || r.kind === 'unusual-low') ?? []
  if (!list.length) return null
  const strict = list.filter((r) => r.thresholds.find((t) => t.threshold === 2.5)?.kind === r.kind)
  const loose = list.filter((r) => r.thresholds.find((t) => t.threshold === 1.5)?.kind === r.kind)
  const testable = list.filter((r) => r.dropOne.tried >= 3)
  const survives = testable.filter((r) => r.dropOne.held === r.dropOne.tried)
  const twoOnly = list.filter((r) => r.dropOne.tried <= 2)
  return {
    key: 'robustness',
    status: strict.length === list.length && survives.length === testable.length ? 'confirms' : 'nuance',
    claim: 'How solid is each verdict?',
    measured: (
      <>
        Re-running the jury with the same rule: <strong>{strict.length} of {list.length}</strong> unusual month{list.length === 1 ? '' : 's'} stay unusual at a stricter 2.5-spread threshold{strict.length ? ` (${strict.map((r) => fmtMonth(r.month, 'short')).join(', ')})` : ''}, and {loose.length} of {list.length} at a looser 1.5.
        {testable.length ? <> With one satellite withheld in turn, {survives.length} of {testable.length} keep their verdict.</> : null}
        {twoOnly.length ? <> {twoOnly.length === list.length ? 'Every verdict here rests' : `${twoOnly.length} of the verdicts rest`} on exactly two satellites agreeing, so withholding either one leaves no jury.</> : null}
      </>
    ),
    further: twoOnly.length ? <>A third independent satellite in the window (Terra or Aqua in its original orbit, or a longer record) would allow the drop-one test. Months that hold only at the default threshold are worth reading as “leaning unusual”.</> : undefined,
  }
}

/** Where it burns: recurring places, and an off-season of its own. */
export function placesCheck(report: BridgeReport): CheckSpec | null {
  const p = report.evidence.places
  if (!p || (!p.recurrent && !p.offSeasonElsewhere)) return null
  const season = span(p.seasonStart, 4)
  return {
    key: 'places',
    status: 'further',
    claim: 'Fire returns to the same places, and the off-season burns elsewhere',
    measured: (
      <>
        {p.recurrent ? <><strong>{p.recurrent.cells} of {fmtInt(p.cells.length)}</strong> burning 5 km cells burned in at least {p.recurrent.minimumYears} of {p.years} years, and they hold <strong>{pct(p.recurrent.cellDayShare)}</strong> of all fire cell-days. </> : null}
        {p.offSeasonElsewhere ? <><strong>{pct(p.offSeasonElsewhere.share)}</strong> of the fire outside the {season} season falls in cells that never burn in that season.</> : null}
      </>
    ),
    science: <>Cropland burning follows agricultural calendars and makes up 8–11% of global fire activity in MODIS data; it repeats in the same fields at the same time of year.</>,
    cites: ['korontzi2006'],
    further: <>Places that burn year after year, with a season of their own, look like managed burning rather than wildfire. Overlaying a land-cover map on these cells would settle it.</>,
  }
}

/** Do new fires keep a weekly rhythm? Weather has no week; people do. */
export function weeklyCheck(report: BridgeReport): CheckSpec | null {
  const w = report.evidence.weekly
  if (!w) return null
  const n = w.counts.reduce((a, b) => a + b, 0)
  const mean = n / 7
  const significant = w.p < 0.05
  return {
    key: 'weekly',
    status: significant ? 'further' : 'open',
    claim: significant ? `Fewer fires start on ${WEEKDAYS[w.quietest]}s: a human rhythm` : 'No weekly rhythm in when fires start',
    measured: (
      <>
        Of {fmtInt(n)} detection clusters, the fewest began on {WEEKDAYS[w.quietest]} ({fmtInt(w.counts[w.quietest])}, {Math.round((w.counts[w.quietest] / mean - 1) * 100)}% against the daily mean) and the most on {WEEKDAYS[w.busiest]} ({fmtInt(w.counts[w.busiest])}). Chi-square test against an even week: <strong>{fmtP(w.p)}</strong>{significant ? '' : ', so the difference is within chance'}.
      </>
    ),
    science: <>Satellite fire counts worldwide show a weekly cycle that only people can cause: about 8% fewer fires on Sundays than on Tuesdays, and Thursday–Friday minimums where Muslim populations are larger.</>,
    cites: ['earl2015'],
    further: significant ? <>A weekly rhythm is a direct fingerprint of human ignition.</> : <>Absence of a rhythm is not proof that people play no part: a cluster’s first detection can lag its ignition by a day or more.</>,
  }
}
