import { describe, expect, it } from 'vitest'
import { ATLAS_SENSORS, buildAtlas, dayIndex, fmtSpan, selectIndices, sensorsOf, summarize } from './atlas'
import { detection, fixture } from './test-fixtures'

const index = (name: string) => ATLAS_SENSORS.indexOf(name as (typeof ATLAS_SENSORS)[number])

describe('fire atlas data', () => {
  const data = buildAtlas(fixture, { start: '2022-01-01', endExclusive: '2023-01-01' })

  it('keeps every valid detection, in time order, with its satellite', () => {
    expect(data.n).toBe(6)
    expect(data.ids).toEqual(['c', 'd', 'a', 'e', 'b', 'f'])
    expect([...data.sensor]).toEqual([index('snpp'), index('terra'), index('aqua'), index('noaa20'), index('noaa20'), index('snpp')])
    expect(data.sensorsPresent).toEqual([index('terra'), index('aqua'), index('snpp'), index('noaa20')])
    expect(data.points[1].properties).toMatchObject({ i: 1, f: -1, m: 1, v: 0 })
    expect(data.points[3].properties).toMatchObject({ f: 5, m: 0, v: 1 })
    expect(data.firstDay).toBe(dayIndex('2022-01-01'))
    expect(data.endDay).toBe(dayIndex('2023-01-01'))
    expect(data.daily[index('noaa20')][dayIndex('2022-07-10') - data.firstDay]).toBe(1)
    expect(data.daily[index('noaa20')][dayIndex('2022-07-11') - data.firstDay]).toBe(1)
  })

  it('selects a period, satellites and a source stream', () => {
    const all = data.sensorsPresent
    const july = { startDay: dayIndex('2022-07-01'), endDay: dayIndex('2022-08-01'), sensors: all, source: null }
    expect(selectIndices(data, july)).toEqual([1, 2, 3, 4, 5])
    expect(selectIndices(data, { ...july, sensors: sensorsOf('modis', all) })).toEqual([1, 2])
    expect(selectIndices(data, { ...july, sensors: sensorsOf('viirs', all) })).toEqual([3, 4, 5])
    expect(selectIndices(data, { ...july, source: data.sources.indexOf('src-NOAA-20') })).toEqual([3, 4])
    expect(selectIndices(data, { ...july, startDay: dayIndex('2022-07-11'), endDay: dayIndex('2022-07-12') })).toEqual([4])
  })

  it('summarises what a set of detections amounts to', () => {
    const summary = summarize(data, [5, 1, 2, 3, 4, 0])
    expect(summary).toMatchObject({ count: 6, modis: 2, viirs: 4, fireDays: 4, maxFrp: 20 })
    expect(summary.years).toEqual([{ year: 2022, count: 6 }])
    expect(summary.bounds).toEqual([-6, 34.5, -5.49, 35.12])
    expect(summary.first).toBe(Date.parse('2022-03-01T13:20:00Z'))
    expect(summary.last).toBe(Date.parse('2022-07-12T13:20:00Z'))
    const spread = buildAtlas([detection('x', 'Aqua', '2019-05-01T12:00:00Z', 0, 0, 1), detection('y', 'Aqua', '2021-05-01T12:00:00Z', 0, 0, 1)])
    expect(summarize(spread, [0, 1]).years).toEqual([{ year: 2019, count: 1 }, { year: 2020, count: 0 }, { year: 2021, count: 1 }])
  })

  it('names periods the way people say them', () => {
    expect(fmtSpan(dayIndex('2022-07-01'), dayIndex('2022-08-01'))).toBe('July 2022')
    expect(fmtSpan(dayIndex('2022-07-12'), dayIndex('2022-07-19'))).toBe('12–18 Jul 2022')
    expect(fmtSpan(dayIndex('2022-07-12'), dayIndex('2022-07-13'))).toBe('12 Jul 2022')
    expect(fmtSpan(dayIndex('2021-12-30'), dayIndex('2022-01-03'))).toBe('30 Dec 2021 – 2 Jan 2022')
  })
})
