import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import type { EChartsOption } from 'echarts'
import { useReducedMotion } from 'motion/react'
import { SENSORS, type SensorKey } from '../../lib/sensors'
import { formatMonth, type MonthBucket, type SensorTotal } from './computeInsights'

echarts.use([AriaComponent, BarChart, GridComponent, TooltipComponent, CanvasRenderer])

export default function SeasonalChart({ months, sensors, height = 280 }: { months: MonthBucket[]; sensors: SensorTotal[]; height?: number }) {
  const reduced = useReducedMotion()
  const keys = sensors.map((sensor) => sensor.key)
  const many = months.length > 18
  const option: EChartsOption = {
    backgroundColor: 'transparent',
    animation: reduced === false,
    animationDuration: 900,
    animationEasing: 'cubicOut',
    animationDelay: (index: number) => index * 25,
    aria: { enabled: true, decal: { show: false } },
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
      backgroundColor: '#171a22',
      borderColor: 'rgba(255,255,255,0.1)',
      padding: [10, 12],
      textStyle: { color: '#f3f4f7', fontFamily: 'Inter Variable, sans-serif', fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 20px 40px -20px rgba(0,0,0,.8);',
      formatter: (items) => {
        const list = Array.isArray(items) ? items : [items]
        const month = months[Number(list[0]?.dataIndex)]
        if (!month) return ''
        const rows = list
          .filter((item) => Number(item.value) > 0)
          .map((item) => `<div style="display:flex;justify-content:space-between;gap:18px"><span>${item.marker}${item.seriesName}</span><b>${Number(item.value).toLocaleString('en-US')}</b></div>`)
          .join('')
        return `<div style="font-weight:600;margin-bottom:6px">${formatMonth(month.month)}</div>${rows || '<span style="color:#737a88">No detections</span>'}<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between"><span style="color:#aab0bc">Total</span><b>${month.total.toLocaleString('en-US')}</b></div>`
      },
    },
    xAxis: {
      type: 'category',
      data: months.map((bucket) => formatMonth(bucket.month, 'short').replace(' ', many ? " '" : '\n').replace(/'(\d{2})(\d{2})/, "'$2")),
      axisLabel: { color: '#737a88', fontSize: 10.5, fontFamily: 'JetBrains Mono Variable, monospace', interval: many ? 'auto' : 0, lineHeight: 14 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: '#737a88', fontSize: 10.5, fontFamily: 'JetBrains Mono Variable, monospace' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: keys.map((key: SensorKey, index) => ({
      name: `${SENSORS[key].label} · ${SENSORS[key].instrument}`,
      type: 'bar',
      stack: 'detections',
      barMaxWidth: 34,
      data: months.map((bucket) => bucket.bySensor[key] ?? 0),
      itemStyle: {
        color: SENSORS[key].color,
        borderRadius: index === keys.length - 1 ? [5, 5, 0, 0] : 0,
      },
      emphasis: { focus: 'series' },
    })),
  }
  return <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height, width: '100%' }} opts={{ renderer: 'canvas' }} />
}
