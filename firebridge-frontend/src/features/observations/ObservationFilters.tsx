import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { emptyObservationFilters, validObservationInterval, type ObservationFilters as Filters } from './filters'
import { useNativeSummary } from './useResults'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { Button } from '../../components/ui/Button'

export function ObservationFilterBar({ analysisId, value, onChange }: {
  analysisId?: string
  value: Filters
  onChange: (value: Filters) => void
}) {
  const summary = useNativeSummary(analysisId)
  const invalid = !validObservationInterval(value)
  return <div className="geo-filter-bar">
    <span className="geo-filter-label"><SlidersHorizontal size={14} />Selection</span>
    <label>Observation source
      <select aria-label="Filter observation source" value={value.sourceId} disabled={!analysisId}
        onChange={(event) => onChange({ ...value, sourceId: event.target.value })}>
        <option value="">All source streams</option>
        {summary.data?.native_detections_by_source.map((source) => <option key={source.source_id} value={source.source_id}>{source.platform} · {source.product}</option>)}
      </select>
    </label>
    <DateRangePicker start={value.start} end={value.endExclusive} disabled={!analysisId} triggerLabel="Open observation filter date picker" onStartChange={start => onChange({ ...value, start })} onEndChange={endExclusive => onChange({ ...value, endExclusive })}>
    <div className="fw-filter-dates"><label>From · UTC<input aria-label="Observation start date" type="date" value={value.start} disabled={!analysisId}
      onChange={(event) => onChange({ ...value, start: event.target.value })} /></label>
    <label>Until · exclusive UTC<input aria-label="Observation end date exclusive" type="date" value={value.endExclusive} disabled={!analysisId}
      aria-invalid={invalid} aria-describedby={invalid ? 'observation-interval-error' : undefined}
      onChange={(event) => onChange({ ...value, endExclusive: event.target.value })} /></label></div>
    </DateRangePicker>
    <Button disabled={!value.sourceId && !value.start && !value.endExclusive}
      onClick={() => onChange(emptyObservationFilters)}><RotateCcw size={13} aria-hidden="true" />Reset</Button>
    <p className="fw-filter-scope">Filters affect matching loaded/paginated map records, the observation table and timeline selection. Aggregate tiles, source inventories and exports retain the full saved analysis scope.</p>
    {invalid && <p id="observation-interval-error" className="fb-field-error" role="alert">The exclusive end must be after the start date.</p>}
  </div>
}
