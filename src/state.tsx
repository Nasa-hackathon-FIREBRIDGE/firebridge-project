import { useMemo, useState, type PropsWithChildren } from 'react'
import type { AreaOfInterest, SatellitePlatform } from './types'
import { ALL_PLATFORM_IDS, togglePlatformIn } from './platforms'
import { StateContext, type AppState } from './state-context'

const DEFAULT_GEOMETRY: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[-6.4, 34.5], [-4.5, 34.5], [-4.5, 35.9], [-6.4, 35.9], [-6.4, 34.5]]] }
const DEFAULT_AREA: AreaOfInterest = { id: 'morocco-demo-bbox', name: 'Northern Morocco pilot', geometry: DEFAULT_GEOMETRY, provenance: 'default-demo' }

export function AppStateProvider({ children }: PropsWithChildren) {
  const [area, setArea] = useState<AreaOfInterest>(DEFAULT_AREA)
  const [startDate, setStartDate] = useState('2024-07-18')
  const [endDate, setEndDate] = useState('2024-07-25')
  const [platforms, setPlatforms] = useState<SatellitePlatform[]>(ALL_PLATFORM_IDS)
  const [searchText, setSearchText] = useState('')
  const [frpThresholdMw, setFrpThreshold] = useState<number | null>(null)
  const [showDetections, setShowDetections] = useState(true)
  const [showArea, setShowArea] = useState(true)
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null)

  const value = useMemo<AppState>(() => ({
    area, startDate, endDate, platforms, searchText, frpThresholdMw, showDetections, showArea, selectedDetectionId,
    setArea,
    resetArea: () => { setArea(DEFAULT_AREA) },
    setStartDate: (date) => { if (!endDate || date <= endDate) setStartDate(date) },
    setEndDate: (date) => { if (!startDate || date >= startDate) setEndDate(date) },
    togglePlatform: (platform) => setPlatforms((current) => togglePlatformIn(current, platform)),
    setPlatforms,
    setSearchText,
    setFrpThreshold,
    setShowDetections,
    setShowArea,
    setSelectedDetectionId,
  }), [area, startDate, endDate, platforms, searchText, frpThresholdMw, showDetections, showArea, selectedDetectionId])

  return <StateContext.Provider value={value}>{children}</StateContext.Provider>
}