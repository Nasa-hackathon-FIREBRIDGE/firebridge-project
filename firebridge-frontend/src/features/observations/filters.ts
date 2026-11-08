export interface ObservationFilters {
  sourceId: string
  start: string
  endExclusive: string
}
export const emptyObservationFilters: ObservationFilters = { sourceId: '', start: '', endExclusive: '' }

export function validObservationInterval(filters: ObservationFilters) {
  return !filters.start || !filters.endExclusive || filters.start < filters.endExclusive
}
