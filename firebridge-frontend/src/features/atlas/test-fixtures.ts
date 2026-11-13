import type { DetectionFeature } from '../observations/types'

export function detection(id: string, platform: string, at: string, lon: number, lat: number, frp: number | null, source = `src-${platform}`): DetectionFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { detection_id: id, source_id: source, platform, acquired_at: at, confidence_raw: 'n', confidence_scheme: 'viirs', day_night: 'D', frp_mw: frp, processing_level: 'L2' },
  }
}

export const fixture = [
  detection('a', 'Aqua', '2022-07-10T13:00:00Z', -5.5, 35.1, 20),
  detection('b', 'NOAA-20', '2022-07-11T13:10:00Z', -5.52, 35.12, 8),
  detection('c', 'Suomi NPP', '2022-03-01T13:20:00Z', -6, 34.5, 2),
  detection('d', 'Terra', '2022-07-10T10:30:00Z', -5.51, 35.1, null),
  detection('e', 'NOAA-20', '2022-07-10T13:10:00Z', -5.5, 35.11, 5),
  detection('f', 'Suomi NPP', '2022-07-12T13:20:00Z', -5.49, 35.09, 3),
  detection('bad', 'Aqua', 'not a date', 0, 0, 1),
]
