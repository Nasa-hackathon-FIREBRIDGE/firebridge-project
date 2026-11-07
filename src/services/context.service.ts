import { getResource, segment } from './resource'
import type { CellView, ComparisonQuery, ComparisonView, CoverageQuery, CoverageView, DateQuery, PageQuery, ReportsQuery, ReportsView, WeatherQuery, WeatherView } from './data.types'
const path = (id: string, endpoint: string) => `/analyses/${segment(id)}/${endpoint}`
export const context = {
  coverage: (id: string, params: CoverageQuery = {}, signal?: AbortSignal) =>
    getResource<CoverageView>(path(id, 'coverage'), params, signal),
  cell: (id: string, cellId: string, params: PageQuery & DateQuery = {}, signal?: AbortSignal) =>
    getResource<CellView>(path(id, `cells/${segment(cellId)}`), params, signal),
  comparison: (id: string, params: ComparisonQuery = {}, signal?: AbortSignal) =>
    getResource<ComparisonView>(path(id, 'comparison'), params, signal),
  weather: (id: string, params: WeatherQuery = {}, signal?: AbortSignal) =>
    getResource<WeatherView>(path(id, 'weather'), params, signal),
  reports: (id: string, params: ReportsQuery = {}, signal?: AbortSignal) =>
    getResource<ReportsView>(path(id, 'reports'), params, signal),
}

