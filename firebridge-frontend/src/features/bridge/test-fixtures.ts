import type { RawDetection } from './engine/index.ts'
import { seededRandom } from './engine/stats.ts'

export const detection = (overrides: Partial<RawDetection> & Pick<RawDetection, 'sourceId' | 'acquiredAt'>): RawDetection => ({
  platform: null,
  lon: -5.5,
  lat: 35.1,
  dayNight: 'day',
  frp: 10,
  confidence: 'n',
  confidenceScheme: 'VIIRS_l_n_h',
  type: '0',
  ...overrides,
})

/** Three synthetic fire seasons. Aqua reports a fire only when VIIRS peak FRP ≥ 15 MW and
 *  the VIIRS record contains many small fires MODIS cannot see. */
export function syntheticSeasons() {
  const random = seededRandom(42)
  const detections: RawDetection[] = []
  for (const year of [2019, 2020, 2021]) {
    for (let month = 1; month <= 12; month++) {
      const fires = 4 + Math.round(random() * (month >= 7 && month <= 9 ? 30 : 6)) + (year === 2021 ? 10 : 0)
      for (let f = 0; f < fires; f++) {
        const day = 1 + Math.floor(random() * 27)
        const lon = -6.4 + random() * 1.8
        const lat = 34.6 + random() * 1.2
        const frp = Math.exp(random() * 5)
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        for (const [source, minute] of [['viirs-snpp-c2-standard', '05'], ['viirs-noaa20-c2-standard', '55']] as const)
          detections.push(detection({ sourceId: source, acquiredAt: `${date}T13:${minute}:00Z`, lon, lat, frp, confidence: frp > 40 ? 'h' : 'n' }))
        if (frp >= 15) detections.push(detection({ sourceId: 'modis-aqua-c61-standard', acquiredAt: `${date}T13:30:00Z`, lon: lon + 0.002, lat, frp: frp * 1.3, confidence: '70', confidenceScheme: 'MODIS_0_100' }))
        if (year === 2021) detections.push(detection({ sourceId: 'viirs-noaa21-c2-standard', acquiredAt: `${date}T13:20:00Z`, lon, lat, frp }))
      }
    }
  }
  return detections
}

