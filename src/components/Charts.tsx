import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import type { EChartsOption } from 'echarts'
import type { SensorComparison, TemporalSummary } from '../types'

echarts.use([BarChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

export function ActivityChart({ data }: { data: TemporalSummary[] }) {
  const option: EChartsOption = {
    backgroundColor: 'transparent',
    grid: { left: 34, right: 12, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis', backgroundColor: '#0c1829', borderColor: '#26405f', textStyle: { color: '#edf2f7' }, formatter: (items) => {
      const item = Array.isArray(items) ? items[0] : items
      const row = data[Number(item?.dataIndex)]
      return `${row?.period ?? ''}<br/><b>${row?.detections ?? 0} synthetic detections</b><br/>Observation coverage: unknown`
    } },
    xAxis: { type: 'category', data: data.map((item) => item.period.slice(5)), axisLabel: { color: '#778696', fontSize: 10 }, axisLine: { lineStyle: { color: '#2b3947' } }, axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#778696', fontSize: 10 }, splitLine: { lineStyle: { color: '#202e3a' } } },
    series: [{ type: 'bar', data: data.map((item) => item.detections), barWidth: 12, itemStyle: { color: '#2a8fd0', borderRadius: [4, 4, 0, 0] }, emphasis: { itemStyle: { color: '#7dd3fc' } } }],
  }
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height: 280, width: '100%' }} opts={{ renderer: 'canvas' }} />
}

export function SensorBars({ data }: { data: SensorComparison['sourceCounts'] }) {
  const option: EChartsOption = {
    backgroundColor: 'transparent',
    grid: { left: 90, right: 18, top: 8, bottom: 12 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#14212d', borderColor: '#344453', textStyle: { color: '#edf2f7' }, formatter: (items) => {
      const item = Array.isArray(items) ? items[0] : items
      return `${item?.name ?? ''}<br/><b>${item?.value ?? 0} raw demo detections</b>`
    } },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#778696', fontSize: 10 }, splitLine: { lineStyle: { color: '#202e3a' } } },
    yAxis: { type: 'category', data: data.map((item) => `${item.sensor} · ${item.platform}`), axisLabel: { color: '#b7c3cf', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'bar', data: data.map((item) => item.detections), barWidth: 13, itemStyle: { color: '#3b82d6', borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: '#bdc8d3', fontSize: 10 } }],
  }
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height: Math.max(100, data.length * 38), width: '100%' }} opts={{ renderer: 'canvas' }} />
}

export function CalendarChart({ data, onSelect }: { data: TemporalSummary[]; onSelect: (period: string) => void }) {
  const max = Math.max(1, ...data.map((item) => item.detections))
  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: { position: 'top', backgroundColor: '#14212d', borderColor: '#344453', textStyle: { color: '#edf2f7' }, formatter: (params) => {
      const row = data[Number((params as { dataIndex?: number }).dataIndex)]
      return row ? `${row.period}<br/><b>${row.detections} synthetic detections</b><br/>Coverage: unknown` : ''
    } },
    grid: { left: 48, right: 24, top: 22, bottom: 30 },
    xAxis: { type: 'category', data: data.map((item) => item.period.slice(5)), splitArea: { show: true, areaStyle: { color: ['rgba(24,38,51,.55)', 'rgba(24,38,51,.8)'] } }, axisLabel: { color: '#8593a1' }, axisLine: { lineStyle: { color: '#344351' } } },
    yAxis: { type: 'category', data: ['2024 · July'], axisLabel: { color: '#b6c1cc' }, axisLine: { show: false } },
    visualMap: { min: 0, max, show: false, inRange: { color: ['#12213a', '#1d5a85', '#38bdf8', '#f0a267'] } },
    series: [{ type: 'heatmap', data: data.map((item, index) => [index, 0, item.detections]), label: { show: false }, itemStyle: { borderWidth: 3, borderColor: '#101a24', borderRadius: 3 }, emphasis: { itemStyle: { borderColor: '#e5f2f1', borderWidth: 2 } } }],
  }
  const onEvents = { click: (params: { dataIndex?: number }) => { const row = data[params.dataIndex ?? -1]; if (row) onSelect(row.period) } }
  return <ReactEChartsCore echarts={echarts} option={option} onEvents={onEvents} notMerge lazyUpdate style={{ height: 150, width: '100%' }} opts={{ renderer: 'canvas' }} />
}