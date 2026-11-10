import * as echarts from 'echarts/core'
import { BarChart, CustomChart, LineChart } from 'echarts/charts'
import { AriaComponent, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import type { CustomSeriesRenderItemAPI, CustomSeriesRenderItemParams, CustomSeriesRenderItemReturn, EChartsOption } from 'echarts'
import { useReducedMotion } from 'motion/react'
import type { SensorKey } from '../../lib/sensors'
import type { BridgeMonth, FrpDistribution, ModelId, OverpassRow, PlatformReplay, ResponseCurve } from './engine/index.ts'
import { fmtClock, fmtInt, fmtMonth, fmtOne, sensorColor, sensorLabel } from './format'

echarts.use([AriaComponent, BarChart, CustomChart, LineChart, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, CanvasRenderer])

const CHART = {
  surface: '#12151c',
  grid: 'rgba(255,255,255,0.05)',
  axis: 'rgba(255,255,255,0.08)',
  text3: '#737a88',
  text2: '#aab0bc',
  fg: '#f3f4f7',
  ember: '#ff7c40',
  neutral: '#8b93a3',
}
const MONO = 'JetBrains Mono Variable, monospace'
const axisLabel = { color: CHART.text3, fontSize: 10.5, fontFamily: MONO }
const tooltip = (formatter: (items: unknown) => string, trigger: 'axis' | 'item' = 'axis') => ({
  trigger,
  axisPointer: { type: 'line' as const, lineStyle: { color: 'rgba(255,255,255,0.18)', width: 1 } },
  backgroundColor: '#171a22',
  borderColor: 'rgba(255,255,255,0.1)',
  padding: [10, 12],
  textStyle: { color: CHART.fg, fontFamily: 'Inter Variable, sans-serif', fontSize: 12 },
  extraCssText: 'border-radius:12px;box-shadow:0 20px 40px -20px rgba(0,0,0,.8);',
  formatter: formatter as never,
})
const row = (marker: string, label: string, value: string) =>
  `<div style="display:flex;justify-content:space-between;gap:18px;align-items:center"><span>${marker}${label}</span><b style="font-weight:600">${value}</b></div>`
const swatch = (color: string, opacity = 1) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${color};opacity:${opacity}"></span>`
const title = (text: string) => `<div style="font-weight:600;margin-bottom:6px">${text}</div>`
const muted = (text: string) => `<div style="margin-top:6px;color:${CHART.text3};font-size:11px">${text}</div>`
const list = (items: unknown) => (Array.isArray(items) ? items : [items]) as { dataIndex: number; seriesId?: string }[]

/** Charts replace their option wholesale unless `merge` is set (the replay merges so its
 *  staged reveal animates series in rather than redrawing). */
function Chart({ option, height, label, merge = false }: { option: EChartsOption; height: number; label: string; merge?: boolean }) {
  const reduced = useReducedMotion()
  return (
    <figure className="m-0 min-w-0" aria-label={label}>
      <ReactEChartsCore
        echarts={echarts}
        option={{ backgroundColor: 'transparent', animation: reduced === false, animationDuration: 900, animationEasing: 'cubicOut', aria: { enabled: true, label: { description: label } }, ...option }}
        notMerge={!merge}
        lazyUpdate
        style={{ height, width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </figure>
  )
}

/* ── Act 2 · overpass regime ─────────────────────────────────────────────── */
const SYMBOL: Partial<Record<SensorKey, string>> = { terra: 'triangle', aqua: 'circle', snpp: 'circle', noaa20: 'rect', noaa21: 'diamond' }

export function OverpassChart({ rows, baseline }: { rows: OverpassRow[]; baseline: number | null }) {
  const day = rows.filter((r) => r.pass === 'day')
  const years = [...new Set(day.map((r) => r.year))].sort()
  const sensors = (['terra', 'aqua', 'snpp', 'noaa20', 'noaa21'] as SensorKey[]).filter((s) => day.some((r) => r.sensor === s))
  const lo = Math.floor(Math.min(...day.map((r) => r.p25), baseline ?? 24) * 2 - 1) / 2
  const hi = Math.ceil(Math.max(...day.map((r) => r.p75), baseline ?? 0) * 2 + 1) / 2
  const find = (sensor: SensorKey, year: string) => day.find((r) => r.sensor === sensor && r.year === year)
  const option: EChartsOption = {
    grid: { left: 8, right: 84, top: 16, bottom: 4, containLabel: true },
    tooltip: tooltip((items) => {
      const year = years[list(items)[0]?.dataIndex]
      const lines = sensors
        .map((sensor) => find(sensor, year))
        .filter(Boolean)
        .map((r) => row(swatch(sensorColor(r!.sensor)), sensorLabel(r!.sensor), `${fmtClock(r!.median)} <span style="color:${CHART.text3};font-weight:400">· ${fmtClock(r!.p25)}–${fmtClock(r!.p75)} · n=${fmtInt(r!.n)}</span>`))
      return title(`${year} · daytime passes`) + lines.join('') + muted('Median local solar time of detections · interquartile range · sample')
    }),
    xAxis: { type: 'category', data: years, axisLabel, axisLine: { lineStyle: { color: CHART.axis } }, axisTick: { show: false }, boundaryGap: false },
    yAxis: { type: 'value', min: lo, max: hi, interval: 0.5, axisLabel: { ...axisLabel, formatter: (v: number) => fmtClock(v) }, splitLine: { lineStyle: { color: CHART.grid } } },
    series: sensors.map((sensor) => ({
      id: sensor,
      name: sensorLabel(sensor),
      type: 'line',
      data: years.map((year) => find(sensor, year)?.median ?? null),
      connectNulls: false,
      symbol: SYMBOL[sensor] ?? 'circle',
      symbolSize: 9,
      lineStyle: { width: 2, color: sensorColor(sensor) },
      itemStyle: { color: sensorColor(sensor), borderColor: CHART.surface, borderWidth: 2 },
      endLabel: { show: sensor === 'aqua' || sensor === 'terra', formatter: sensorLabel(sensor), color: CHART.text2, fontSize: 11, distance: 8 },
      emphasis: { focus: 'series' },
      ...(sensor === 'aqua' && baseline !== null
        ? {
            markArea: {
              silent: true,
              itemStyle: { color: 'rgba(56,198,244,0.07)' },
              label: { show: true, position: 'insideTopLeft', color: CHART.text3, fontSize: 10.5, formatter: 'Aqua early-record pass ±30 min' },
              data: [[{ yAxis: baseline - 0.5 }, { yAxis: baseline + 0.5 }]],
            },
          }
        : {}),
    })),
  }
  return <Chart option={option} height={300} label="Median local solar time of daytime detections by satellite and year" />
}

/* ── Act 3 · FRP distributions and detection response ────────────────────── */
const FRP_CENTRES = [0.35, 0.71, 1.41, 2.83, 5.66, 11.3, 22.6, 45.3, 90.5, 181, 362, 724]

export function FrpChart({ reference, platform, floor }: { reference: FrpDistribution; platform: FrpDistribution & { group: SensorKey }; floor: number | null }) {
  const series = (dist: FrpDistribution, key: SensorKey, id: 'reference' | 'platform') => ({
    id,
    name: sensorLabel(key),
    type: 'line' as const,
    smooth: 0.35,
    symbol: 'none',
    lineStyle: { width: 2, color: sensorColor(key) },
    itemStyle: { color: sensorColor(key) },
    areaStyle: { color: sensorColor(key), opacity: 0.1 },
    data: FRP_CENTRES.map((centre, i) => [centre, Math.round(dist.shares[i] * 1000) / 10]),
  })
  const option: EChartsOption = {
    grid: { left: 8, right: 16, top: 34, bottom: 4, containLabel: true },
    tooltip: tooltip((items) => {
      const i = list(items)[0]?.dataIndex
      const edges = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512]
      const label = i === 0 ? '< 0.5 MW' : i === 11 ? '≥ 512 MW' : `${edges[i]}–${edges[i + 1]} MW`
      return title(`FRP ${label}`) + row(swatch(sensorColor('aqua')), 'Aqua', `${(reference.shares[i] * 100).toFixed(1)}%`) + row(swatch(sensorColor(platform.group)), sensorLabel(platform.group), `${(platform.shares[i] * 100).toFixed(1)}%`) + muted('Share of each satellite’s daytime detections')
    }),
    xAxis: { type: 'log', logBase: 2, min: 0.25, max: 1024, axisLabel: { ...axisLabel, formatter: (v: number) => (v < 1 ? String(v) : fmtInt(v)) }, name: 'FRP (MW, log scale)', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: CHART.text3, fontSize: 10.5 }, axisLine: { lineStyle: { color: CHART.axis } }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { ...axisLabel, formatter: '{value}%' }, splitLine: { lineStyle: { color: CHART.grid } } },
    series: [
      series(reference, 'aqua', 'reference'),
      {
        ...series(platform, platform.group, 'platform'),
        markLine:
          floor === null
            ? undefined
            : { silent: true, symbol: 'none', lineStyle: { color: CHART.text2, width: 1, type: 'solid' }, label: { color: CHART.text2, fontSize: 11, formatter: `MODIS floor ${floor} MW`, position: 'end' }, data: [{ xAxis: floor }] },
      },
    ],
  }
  return <Chart option={option} height={280} label={`Distribution of fire radiative power, Aqua versus ${sensorLabel(platform.group)}`} />
}

export function ResponseChart({ curve }: { curve: ResponseCurve }) {
  const color = sensorColor('aqua')
  const whisker = (params: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
    void params
    const low = api.coord([api.value(0), api.value(1)])
    const high = api.coord([api.value(0), api.value(2)])
    const style = { stroke: CHART.text2, lineWidth: 1 }
    return {
      type: 'group',
      children: [
        { type: 'line', shape: { x1: low[0], y1: low[1], x2: high[0], y2: high[1] }, style },
        { type: 'line', shape: { x1: low[0] - 4, y1: low[1], x2: low[0] + 4, y2: low[1] }, style },
        { type: 'line', shape: { x1: high[0] - 4, y1: high[1], x2: high[0] + 4, y2: high[1] }, style },
        // Value label sits above the interval so it never collides with the whisker.
        { type: 'text', style: { text: `${Math.round(Number(api.value(3)))}%`, x: high[0], y: high[1] - 5, align: 'center', verticalAlign: 'bottom', fill: CHART.text2, fontSize: 11, fontFamily: 'Inter Variable, sans-serif' } },
      ],
    }
  }
  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
    tooltip: tooltip((items) => {
      const bin = curve.bins[list(items)[0]?.dataIndex]
      if (!bin) return ''
      return (
        title(`${sensorLabel(curve.platform)} peak FRP ${bin.label} MW`) +
        row('', 'Aqua also detected', bin.rate === null ? '—' : `${Math.round(bin.rate * 100)}%`) +
        row('', '90% interval', bin.interval ? `${Math.round(bin.interval[0] * 100)}–${Math.round(bin.interval[1] * 100)}%` : '—') +
        row('', 'Cell-days', `${fmtInt(bin.detected)} of ${fmtInt(bin.n)}`) +
        muted('Aqua active within ±1 cell (≈5–10 km) on the same day')
      )
    }),
    xAxis: { type: 'category', data: curve.bins.map((b) => `${b.label} MW`), axisLabel, axisLine: { lineStyle: { color: CHART.axis } }, axisTick: { show: false } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { ...axisLabel, formatter: '{value}%' }, splitLine: { lineStyle: { color: CHART.grid } } },
    series: [
      {
        type: 'bar',
        name: 'Aqua also detected',
        clip: false,
        barMaxWidth: 24,
        data: curve.bins.map((b) => ({ value: b.rate === null ? null : Math.round(b.rate * 1000) / 10, itemStyle: { color, opacity: b.n < 10 ? 0.4 : 1, borderRadius: [4, 4, 0, 0] } })),
      },
      {
        type: 'custom',
        name: '90% interval',
        renderItem: whisker,
        encode: { x: 0, y: [1, 2] },
        z: 3,
        silent: true,
        data: curve.bins.map((b, i) => (b.interval && b.rate !== null ? [i, b.interval[0] * 100, b.interval[1] * 100, b.rate * 100] : [i, NaN, NaN, NaN])),
      },
    ],
  }
  return <Chart option={option} height={260} label={`Share of ${sensorLabel(curve.platform)} cell-days that Aqua also detected, by ${sensorLabel(curve.platform)} peak FRP`} />
}

/* ── Act 4 · withheld-satellite replay ───────────────────────────────────── */
export type ReplayStage = 'withheld' | 'predicted' | 'revealed'

export function ReplayChart({ replay, model, stage, bandK }: { replay: PlatformReplay; model: ModelId; stage: ReplayStage; bandK: number }) {
  const months = replay.months
  const labels = months.map((m) => m.month)
  const predicted = months.map((m) => m.predicted[model])
  const low = predicted.map((p) => Math.max(0, p - bandK * Math.sqrt(p + 1)))
  const span = predicted.map((p, i) => p + bandK * Math.sqrt(p + 1) - low[i])
  const showPrediction = stage !== 'withheld'
  const reveal = stage === 'revealed'
  const yearly = replay.blockKind === 'year'
  const blocks: [string, string][] = []
  for (const block of [...new Set(months.map((m) => m.block))]) {
    const inBlock = months.filter((m) => m.block === block)
    blocks.push([inBlock[0].month, inBlock[inBlock.length - 1].month])
  }
  const max = Math.max(1, ...months.map((m) => m.actual), ...predicted.map((p) => p + bandK * Math.sqrt(p + 1)))
  const option: EChartsOption = {
    grid: [
      { left: 8, right: 12, top: 6, height: 44, containLabel: true },
      { left: 8, right: 12, top: 74, bottom: 4, containLabel: true },
    ],
    tooltip: tooltip((items) => {
      const m = months[list(items)[0]?.dataIndex]
      if (!m) return ''
      const p = m.predicted[model]
      return (
        title(fmtMonth(m.month, 'long')) +
        row(swatch(CHART.neutral), `${sensorLabel(replay.platform)} cell-days (input)`, fmtInt(m.platformCellDays)) +
        (showPrediction ? row(swatch(CHART.ember), 'Predicted Aqua-equivalent', `${fmtOne(p)} <span style="color:${CHART.text3};font-weight:400">(${fmtOne(low[months.indexOf(m)])}–${fmtOne(p + bandK * Math.sqrt(p + 1))})</span>`) : '') +
        (reveal ? row(swatch(sensorColor('aqua')), 'Revealed Aqua cell-days', fmtInt(m.actual)) : row(swatch(sensorColor('aqua'), 0.3), 'Aqua', 'withheld')) +
        muted(`Predicted by a model that never saw ${yearly ? m.block : 'this month or its neighbours'}`)
      )
    }),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    xAxis: [
      { type: 'category', gridIndex: 0, data: labels, axisLabel: { show: false }, axisLine: { lineStyle: { color: CHART.axis } }, axisTick: { show: false } },
      {
        type: 'category',
        gridIndex: 1,
        data: labels,
        axisLine: { lineStyle: { color: CHART.axis } },
        axisTick: { show: false },
        axisLabel: { ...axisLabel, interval: 0, formatter: (v: string) => (yearly ? (v.endsWith('-01') || v === labels[0] ? v.slice(0, 4) : '') : fmtMonth(v).slice(0, 3)) },
      },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, splitNumber: 1, axisLabel: { ...axisLabel, fontSize: 9.5 }, splitLine: { show: false } },
      { type: 'value', gridIndex: 1, max: Math.ceil(max * 1.08), minInterval: 1, axisLabel, splitLine: { lineStyle: { color: CHART.grid } } },
    ],
    series: [
      {
        id: 'input',
        name: `${sensorLabel(replay.platform)} cell-days (model input)`,
        type: 'bar',
        xAxisIndex: 0,
        yAxisIndex: 0,
        barMaxWidth: 8,
        itemStyle: { color: CHART.neutral, opacity: 0.55, borderRadius: [2, 2, 0, 0] },
        data: months.map((m) => m.platformCellDays),
      },
      {
        id: 'band-low',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        stack: 'band',
        symbol: 'none',
        silent: true,
        lineStyle: { opacity: 0 },
        data: showPrediction ? low : [],
        markArea: yearly
          ? { silent: true, itemStyle: { color: 'rgba(255,255,255,0.025)' }, data: blocks.filter((_, i) => i % 2 === 0).map(([a, b]) => [{ xAxis: a }, { xAxis: b }]) as never }
          : undefined,
      },
      { id: 'band-span', type: 'line', xAxisIndex: 1, yAxisIndex: 1, stack: 'band', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, areaStyle: { color: CHART.ember, opacity: 0.14 }, data: showPrediction ? span : [] },
      { id: 'revealed', name: 'Revealed Aqua', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 12, itemStyle: { color: sensorColor('aqua'), borderRadius: [3, 3, 0, 0] }, data: reveal ? months.map((m) => m.actual) : [] },
      { id: 'predicted', name: 'Predicted Aqua-equivalent', type: 'line', xAxisIndex: 1, yAxisIndex: 1, symbol: 'circle', symbolSize: 6, showSymbol: false, lineStyle: { width: 2, color: CHART.ember }, itemStyle: { color: CHART.ember, borderColor: CHART.surface, borderWidth: 2 }, z: 4, data: showPrediction ? predicted : [] },
    ],
  }
  return <Chart merge option={option} height={340} label={`Withheld-Aqua replay for ${sensorLabel(replay.platform)}: predicted versus revealed Aqua-active cell-days per month`} />
}

/* ── Act 5 · the bridge ──────────────────────────────────────────────────── */
export interface IndexedSeries {
  id: 'raw' | 'constant' | 'bridge'
  name: string
  color: string
  values: (number | null)[]
  low?: (number | null)[]
  high?: (number | null)[]
}

export function IndexedYearsChart({ years, series, events }: { years: string[]; series: IndexedSeries[]; events: { year: string; label: string }[] }) {
  const bridge = series.find((s) => s.id === 'bridge')
  const all = series.flatMap((s) => [...s.values, ...(s.high ?? [])]).filter((v): v is number => v !== null)
  const option: EChartsOption = {
    grid: { left: 8, right: 112, top: 36, bottom: 4, containLabel: true },
    tooltip: tooltip((items) => {
      const i = list(items)[0]?.dataIndex
      return (
        title(years[i]) +
        series.map((s) => row(swatch(s.color), s.name, s.values[i] === null ? '—' : `${Math.round(s.values[i]!)}${s.low && s.low[i] !== null && s.high?.[i] !== null && s.low[i] !== s.high![i] ? ` <span style="color:${CHART.text3};font-weight:400">(${Math.round(s.low[i]!)}–${Math.round(s.high![i]!)})</span>` : ''}`)).join('') +
        muted(`Index: ${years[0]} = 100 on each scale`)
      )
    }),
    xAxis: { type: 'category', data: years, boundaryGap: false, axisLabel, axisLine: { lineStyle: { color: CHART.axis } }, axisTick: { show: false } },
    yAxis: { type: 'value', min: 0, max: Math.ceil((Math.max(120, ...all) * 1.08) / 20) * 20, axisLabel, splitLine: { lineStyle: { color: CHART.grid } } },
    series: [
      ...(bridge?.low && bridge.high
        ? [
            { id: 'bridge-low', type: 'line' as const, stack: 'bridge-band', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, data: bridge.low },
            { id: 'bridge-span', type: 'line' as const, stack: 'bridge-band', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, areaStyle: { color: CHART.ember, opacity: 0.12 }, data: bridge.high.map((h, i) => (h === null || bridge.low![i] === null ? null : h - bridge.low![i]!)) },
          ]
        : []),
      ...series.map((s) => ({
        id: s.id,
        name: s.name,
        type: 'line' as const,
        data: s.values,
        symbol: 'circle',
        symbolSize: s.id === 'bridge' ? 9 : 7,
        lineStyle: { width: 2, color: s.color },
        itemStyle: { color: s.color, borderColor: CHART.surface, borderWidth: 2 },
        endLabel: { show: true, formatter: s.id === 'bridge' ? 'Aqua-equivalent' : s.id === 'raw' ? 'All satellites' : s.name.replace(/ only.*/, ' only'), color: CHART.text2, fontSize: 11, distance: 8 },
        labelLayout: { moveOverlap: 'shiftY' as const },
        z: s.id === 'bridge' ? 5 : 3,
        emphasis: { focus: 'series' as const },
        markLine:
          s.id === 'raw'
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: 'rgba(255,255,255,0.16)', width: 1, type: 'solid' as const },
                label: { color: CHART.text3, fontSize: 10.5, position: 'end' as const },
                data: [{ yAxis: 100, label: { formatter: '' } }, ...events.map((e) => ({ xAxis: e.year, label: { formatter: e.label } }))],
              }
            : undefined,
      })),
    ],
  }
  return <Chart option={option} height={320} label="Year-to-year index of all-satellite detections, one constant sensor, and the Aqua-equivalent bridge" />
}

export function MonthlyBridgeChart({ months, platformLabel }: { months: BridgeMonth[]; platformLabel: (key: SensorKey) => string }) {
  const labels = months.map((m) => m.month)
  const value = (m: BridgeMonth, kind: 'observed' | 'drift' | 'estimated') => {
    if (!m.bridge) return null
    const observed = m.bridge.source === 'aqua'
    if (kind === 'estimated') return observed ? null : Math.round(m.bridge.value * 10) / 10
    if (!observed) return null
    return (kind === 'drift') === m.referenceDrift ? m.bridge.value : null
  }
  const gaps: [string, string][] = []
  for (let i = 0; i < months.length; i++) {
    if (months[i].bridge) continue
    let j = i
    while (j + 1 < months.length && !months[j + 1].bridge) j++
    gaps.push([months[i].month, months[j].month])
    i = j
  }
  const whisker = (params: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
    void params
    const a = api.coord([api.value(0), api.value(1)])
    const b = api.coord([api.value(0), api.value(2)])
    return { type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: CHART.text2, lineWidth: 1 } }
  }
  const many = months.length > 24
  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: tooltip((items) => {
      const m = months[list(items)[0]?.dataIndex]
      if (!m) return ''
      const lines = !m.bridge
        ? row('', 'Aqua-equivalent', 'no supported record')
        : m.bridge.source === 'aqua'
          ? row(swatch(sensorColor('aqua'), m.referenceDrift ? 0.45 : 1), 'Observed Aqua cell-days', fmtInt(m.bridge.value)) + (m.referenceDrift ? muted('Aqua overpass more than 30 min from its early-record time') : '')
          : row(swatch(CHART.ember), `Estimated from ${platformLabel(m.bridge.source)}`, `${fmtOne(m.bridge.value)} <span style="color:${CHART.text3};font-weight:400">(${fmtOne(m.bridge.low)}–${fmtOne(m.bridge.high)})</span>`)
      return title(fmtMonth(m.month, 'long')) + lines + row('', 'Native detections, all satellites', fmtInt(m.raw))
    }),
    xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: CHART.axis } }, axisTick: { show: false }, axisLabel: { ...axisLabel, interval: 0, formatter: (v: string) => (many ? (v.endsWith('-01') || v === labels[0] ? v.slice(0, 4) : '') : fmtMonth(v).slice(0, 3)) } },
    yAxis: { type: 'value', minInterval: 1, axisLabel, splitLine: { lineStyle: { color: CHART.grid } } },
    series: [
      { id: 'observed', name: 'Observed Aqua', type: 'bar', stack: 'm', barMaxWidth: 16, itemStyle: { color: sensorColor('aqua'), borderRadius: [4, 4, 0, 0] }, data: months.map((m) => value(m, 'observed')),
        markArea: gaps.length ? { silent: true, itemStyle: { color: 'rgba(255,255,255,0.035)' }, label: { show: !many, color: CHART.text3, fontSize: 10, position: 'insideTop', formatter: 'no record' }, data: gaps.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]) as never } : undefined },
      { id: 'drift', name: 'Observed Aqua (drifted pass)', type: 'bar', stack: 'm', barMaxWidth: 16, itemStyle: { color: sensorColor('aqua'), opacity: 0.45, borderRadius: [4, 4, 0, 0] }, data: months.map((m) => value(m, 'drift')) },
      { id: 'estimated', name: 'VIIRS-estimated', type: 'bar', stack: 'm', barMaxWidth: 16, itemStyle: { color: CHART.ember, borderRadius: [4, 4, 0, 0] }, data: months.map((m) => value(m, 'estimated')) },
      { id: 'range', type: 'custom', renderItem: whisker, encode: { x: 0, y: [1, 2] }, silent: true, z: 5, data: months.map((m, i) => (m.bridge && m.bridge.source !== 'aqua' ? [i, m.bridge.low, m.bridge.high] : [i, NaN, NaN])) },
    ],
  }
  return <Chart option={option} height={260} label="Monthly Aqua-equivalent active cell-days: observed where Aqua is inventoried, VIIRS-estimated elsewhere" />
}
