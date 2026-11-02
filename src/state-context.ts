import { createContext } from 'react'
import type { AnalysisSelection, AreaOfInterest, SatellitePlatform } from './types'

export interface AppState extends AnalysisSelection {
  showDetections: boolean
  showArea: boolean
  selectedDetectionId: string | null
  setArea: (area: AreaOfInterest) => void
  resetArea: () => void
  setStartDate: (date: string) => void
  setEndDate: (date: string) => void
  togglePlatform: (platform: SatellitePlatform) => void
  setPlatforms: (platforms: SatellitePlatform[]) => void
  setSearchText: (text: string) => void
  setFrpThreshold: (value: number | null) => void
  setShowDetections: (value: boolean) => void
  setShowArea: (value: boolean) => void
  setSelectedDetectionId: (id: string | null) => void
}

export const StateContext = createContext<AppState | null>(null)
