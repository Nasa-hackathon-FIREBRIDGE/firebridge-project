import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import type { EChartsOption } from 'echarts'
import type { SensorComparison, TemporalSummary } from '../types'
import { useEffect, useState } from 'react'

echarts.use([AriaComponent, BarChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

function useChartAppearance() {
  const [reducedMotion, setReducedMotion] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReducedMotion(media.matches)
    changed(); media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  const css = getComputedStyle(document.documentElement)
  const color = (name: string) => css.getPropertyValue(name).trim()
  return { reducedMotion, text: color('--muted'), line: color('--line'), blue: color('--blue'), accent: color('--accent'), panel: color('--panel'), foreground: color('--text'), page: color('--page'), orange: color('--orange') }
}

export function ActivityChart({ data }: { data: TemporalSummary[] }) {
  const theme = useChartAppearance()
  const option: EChartsOption = {
    backgroundColor: 'transparent', animation: !theme.reducedMotion, aria: { enabled: true },
    grid: { left: 34, right: 12, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis', backgroundColor: theme.panel, borderColor: theme.line, textStyle: { color: theme.foreground }, formatter: (items) => {
      const item = Array.isArray(items) ? items[0] : items
      const row = data[Number(item?.dataIndex)]
      return `${row?.period ?? ''}<br/><b>${row?.detections ?? 0} synthetic detections</b><br/>Observation coverage: unknown`
    } },
    xAxis: { type: 'category', data: data.map((item) => item.period.slice(5)), axisLabel: { color: theme.text, fontSize: 10 }, axisLine: { lineStyle: { color: theme.line } }, axisTick: { show: false } },
    yAxis: { type: 'value', name: 'Records', nameTextStyle: { color: theme.text, fontSize: 10 }, minInterval: 1, axisLabel: { color: theme.text, fontSize: 10 }, splitLine: { lineStyle: { color: theme.line } } },
    series: [{ type: 'bar', data: data.map((item) => item.detections), barWidth: 12, itemStyle: { color: theme.accent, borderRadius: [4, 4, 0, 0] }, emphasis: { itemStyle: { color: theme.orange } } }],
  }
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height: 280, width: '100%' }} opts={{ renderer: 'canvas' }} />
}

export function SensorBars({ data }: { data: SensorComparison['sourceCounts'] }) {
  const theme = useChartAppearance()
  const option: EChartsOption = {
    backgroundColor: 'transparent', animation: !theme.reducedMotion, aria: { enabled: true },
    grid: { left: 90, right: 18, top: 8, bottom: 12 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: theme.panel, borderColor: theme.line, textStyle: { color: theme.foreground }, formatter: (items) => {
      const item = Array.isArray(items) ? items[0] : items
      return `${item?.name ?? ''}<br/><b>${item?.value ?? 0} raw demo detections</b>`
    } },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { color: theme.text, fontSize: 10 }, splitLine: { lineStyle: { color: theme.line } } },
    yAxis: { type: 'category', data: data.map((item) => `${item.sensor} · ${item.platform}`), axisLabel: { color: theme.text, fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'bar', data: data.map((item) => item.detections), barWidth: 13, itemStyle: { color: theme.accent, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: theme.text, fontSize: 10 } }],
  }
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height: Math.max(100, data.length * 38), width: '100%' }} opts={{ renderer: 'canvas' }} />
}

export function CalendarChart({ data, onSelect }: { data: TemporalSummary[]; onSelect: (period: string) => void }) {
  const theme = useChartAppearance()
  const max = Math.max(1, ...data.map((item) => item.detections))
  const option: EChartsOption = {
    backgroundColor: 'transparent', animation: !theme.reducedMotion, aria: { enabled: true },
    tooltip: { position: 'top', backgroundColor: theme.panel, borderColor: theme.line, textStyle: { color: theme.foreground }, formatter: (params) => {
      const row = data[Number((params as { dataIndex?: number }).dataIndex)]
      return row ? `${row.period}<br/><b>${row.detections} synthetic detections</b><br/>Coverage: unknown` : ''
    } },
    grid: { left: 48, right: 24, top: 22, bottom: 30 },
    xAxis: { type: 'category', data: data.map((item) => item.period.slice(5)), splitArea: { show: true, areaStyle: { color: [theme.panel, theme.page] } }, axisLabel: { color: theme.text }, axisLine: { lineStyle: { color: theme.line } } },
    yAxis: { type: 'category', data: ['2024 · July'], axisLabel: { color: theme.text }, axisLine: { show: false } },
    visualMap: { min: 0, max, show: false, inRange: { color: [theme.panel, '#6e2610', '#e84a10', '#ffb547'] } },
    series: [{ type: 'heatmap', data: data.map((item, index) => [index, 0, item.detections]), label: { show: false }, itemStyle: { borderWidth: 3, borderColor: theme.page, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: theme.foreground, borderWidth: 2 } } }],
  }
  const onEvents = { click: (params: { dataIndex?: number }) => { const row = data[params.dataIndex ?? -1]; if (row) onSelect(row.period) } }
  return <ReactEChartsCore echarts={echarts} option={option} onEvents={onEvents} notMerge lazyUpdate style={{ height: 150, width: '100%' }} opts={{ renderer: 'canvas' }} />
}
