import { UserInputError } from '../../lib/userFeedback'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { AreaView } from '@firebridge/contracts'
import { useArea, useCreateArea } from '../../hooks/useFirebridge'
import { ApiError, Empty, Status } from './Feedback'
import { parseAreaGeometry, validId } from './validation'
import { workspaceKeys } from '../../hooks/useWorkspace'
import type { WorkspacePage } from '../../services/workspace.service'
import { Button } from '../../components/ui/Button'
import { CopyableId } from '../../components/ui/CopyableId'
import { SquareDashedMousePointer } from 'lucide-react'

export function AreaPanel({
  id,
  onSelect,
  geometryText,
  onGeometryText,
  onStartDrawing,
  onSavingState,
}: {
  id?: string
  onSelect: (id: string) => void
  geometryText: string
  onGeometryText: (value: string) => void
  onStartDrawing?: () => void
  onSavingState?: (pending: boolean) => void
}) {
  const create = useCreateArea()
  const area = useArea(id)
  const [error, setError] = useState<unknown>(null)
  const geoEditor = useRef<HTMLDetailsElement>(null)
  const metadataEditor = useRef<HTMLDetailsElement>(null)
  const queryClient = useQueryClient()
  const cachedAreas = queryClient.getQueryData<InfiniteData<WorkspacePage<AreaView>>>(workspaceKeys.areas)?.pages.flatMap(page => page.items) ?? []
  const loadedAreas = [...new Map([...cachedAreas, ...(area.data ? [area.data] : [])].map(item => [item.id, item])).values()]
  useEffect(() => { onSavingState?.(create.isPending) }, [create.isPending, onSavingState])
  useEffect(() => {
    if (!(error instanceof UserInputError)) return
    if (error.field === 'geometry' && geoEditor.current) { geoEditor.current.open = true; geoEditor.current.querySelector<HTMLTextAreaElement>('textarea')?.focus() }
    if (error.field === 'timezone' && metadataEditor.current) { metadataEditor.current.open = true; metadataEditor.current.querySelector<HTMLInputElement>('input[name="timezone"]')?.focus() }
  }, [error])
  const lock = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setError(null)
    try {
      const geometry = parseAreaGeometry(geometryText)
      const input = {
        name: String(form.get('name')).trim(),
        version: String(form.get('version')).trim(),
        display_timezone: String(form.get('timezone')).trim(),
        provenance: String(form.get('provenance')).trim(),
        geometry,
      }
      if (!input.name || !input.version || !input.provenance)
        throw new UserInputError('Name, version and provenance are required.')
      try {
        new Intl.DateTimeFormat('en', { timeZone: input.display_timezone })
      } catch {
        throw new UserInputError(
          'Use a valid IANA timezone, such as Africa/Casablanca.',
          'timezone',
        )
      }
      lock.current = true
      const result = await create.mutateAsync(input)
      onSelect(result.id)
    } catch (reason) {
      setError(reason)
      if (reason instanceof UserInputError && reason.field) {
        const field = formElement.elements.namedItem(reason.field)
        if (field instanceof HTMLElement) field.focus()
      }
    } finally {
      lock.current = false
    }
  }
  return (
    <section className="fb-section fw-area-panel" aria-labelledby="area-heading">
      <div className="fb-section-heading">
        <span className="fb-step">01</span>
        <div>
          <h2 id="area-heading">Define an area</h2>
          <p>Draw a rectangle or polygon on the map, or paste GeoJSON.</p>
        </div>
      </div>
      {onStartDrawing && <Button variant="primary" onClick={onStartDrawing}><SquareDashedMousePointer size={16} aria-hidden="true" />Draw on map</Button>}
      <p className="fw-helper">{geometryText ? 'Draft geometry is available. Name and save the area before requesting an analysis.' : 'Draw your area on the map, then name and save it.'}</p>
      <details className="fb-editor" open={!id}>
        <summary>
          {id ? 'Define another study area' : 'Create a study boundary'}
          <span>Polygon / WGS 84</span>
        </summary>
        <form
          id="area-create-form"
          className="fb-form"
          onSubmit={(event) => {
            void submit(event)
          }}
        >
          <fieldset disabled={create.isPending}>
              <label>
                Area name
                <input name="name" required maxLength={500} placeholder="Name your study area" />
              </label>
            <Button variant="primary" type="submit" className="fw-primary-submit" loading={create.isPending}>{create.isPending ? 'Saving area…' : 'Save area'}</Button>
            <details ref={metadataEditor} className="fw-advanced" onInvalidCapture={event => { event.currentTarget.open = true }}><summary>Area metadata · version, timezone and provenance</summary>
            <div className="fb-field-pair">
              <label>
                Version
                <input name="version" defaultValue="v1" required maxLength={100} />
              </label>
            </div>
            <div className="fb-field-pair">
              <label>
                Display timezone
                <input
                  name="timezone"
                  aria-label="Display timezone"
                  defaultValue="Africa/Casablanca"
                  required
                  maxLength={100}
                  aria-invalid={error instanceof UserInputError && error.field === 'timezone'}
                  aria-describedby={
                    error instanceof UserInputError && error.field === 'timezone'
                      ? 'area-timezone-error'
                      : undefined
                  }
                  onChange={() => setError(null)}
                />
                {error instanceof UserInputError && error.field === 'timezone' && (
                  <span className="fb-field-error" id="area-timezone-error">
                    Use a city timezone such as Africa/Casablanca or UTC.
                  </span>
                )}
              </label>
              <label>
                Provenance
                <input
                  name="provenance"
                  defaultValue="user-provided geometry"
                  required
                  maxLength={500}
                />
              </label>
            </div>
            </details>
            <details ref={geoEditor} className="fw-advanced"><summary>Paste GeoJSON · advanced</summary>
            <label>
              GeoJSON Polygon
              <textarea
                name="geometry"
                aria-label="GeoJSON Polygon"
                aria-describedby={
                  error instanceof UserInputError && error.field === 'geometry'
                    ? 'geometry-help geometry-error'
                    : 'geometry-help'
                }
                aria-invalid={error instanceof UserInputError && error.field === 'geometry'}
                rows={5}
                value={geometryText}
                onChange={(event) => {
                  onGeometryText(event.target.value)
                  setError(null)
                  create.reset()
                }}
                placeholder={'{"type":"Polygon","coordinates":[…]}'}
                required
                onInvalid={() => { if (geoEditor.current) geoEditor.current.open = true }}
                spellCheck={false}
              />
              {error instanceof UserInputError && error.field === 'geometry' && (
                <span id="geometry-error" className="fb-field-error">
                  {error.message}
                </span>
              )}
            </label>
            <p id="geometry-help" className="fb-muted">
              WGS 84 [longitude, latitude]. Holes and antimeridian crossings are preserved. The
              server validates topology, vertex limits and surface.
            </p>
            </details>
          </fieldset>
        </form>
      </details>
      <ApiError context="area" operation="write" error={error} />
      {create.isSuccess && id === create.data.id && (
        <p role="status">
          {create.data.created
            ? 'Area saved. Ready for analysis.'
            : 'Existing area opened. Ready for analysis.'}
        </p>
      )}
      <details className="fb-resource-loader">
        <summary>Open a saved area</summary>
        {loadedAreas.length ? <label className="fw-loaded-areas">Saved areas already loaded<select aria-label="Saved areas already loaded" value={id ?? ''} onChange={event => { if (event.target.value) { if (!validId(event.target.value)) { setError(new UserInputError('Enter a valid area UUID.')); return } setError(null); create.reset(); onSelect(event.target.value) } }}>
          <option value="">Choose a saved area</option>{loadedAreas.map(item => <option key={item.id} value={item.id}>{item.name} · {item.version}</option>)}
        </select></label> : <p className="fw-helper">No saved-area list is loaded here. Open an existing UUID below.</p>}
        <form
          className="fb-load-form"
          onSubmit={(event) => {
            event.preventDefault()
            const value = String(new FormData(event.currentTarget).get('area-id')).trim()
            if (!validId(value)) {
              setError(new UserInputError('Enter a valid area UUID.'))
              return
            }
            setError(null)
            create.reset()
            onSelect(value)
          }}
        >
          <label>
            Open saved area
            <input name="area-id" placeholder="Area UUID" required />
          </label>
          <button type="submit" className="button button-secondary">
            Open area
          </button>
        </form>
      </details>
      {id ? (
        <>
          <ApiError
            error={area.error}
            retry={() => {
              void area.refetch()
            }}
          />
          {area.isPending && <p role="status">Loading area details…</p>}
          {area.data && <AreaDetails area={area.data} />}
        </>
      ) : (
        <Empty>No area selected. Save a boundary or open an existing area.</Empty>
      )}
    </section>
  )
}

function AreaDetails({ area }: { area: AreaView }) {
  return (
    <div className="fb-details">
      <h3>{area.name}</h3>
      <dl>
        <div>
          <dt>Area ID</dt>
          <dd>
            <CopyableId value={area.id} label="area ID" />
          </dd>
        </div>
        <div>
          <dt>Surface</dt>
          <dd>
            {area.surface_km2 === undefined
              ? 'Not supplied'
              : `${area.surface_km2.toLocaleString()} km²`}
          </dd>
        </div>
        <div>
          <dt>Version / timezone</dt>
          <dd>
            {area.version} · {area.display_timezone}
          </dd>
        </div>
        <div>
          <dt>Provenance</dt>
          <dd>{area.provenance}</dd>
        </div>
        <div>
          <dt>Weights</dt>
          <dd>
            {area.coverage ? (
              <Status value={area.coverage.weights_status} />
            ) : (
              'Coverage not supplied'
            )}
          </dd>
        </div>
      </dl>
      {area.coverage?.weights_status === 'not_prepared' && (
        <p className="fb-muted">
          Grid weights have not been calculated. Native detections use no grid.
        </p>
      )}
      {area.coverage?.weights_status === 'prepared' && (
        <p>
          {area.coverage.cells_count} cells ·{' '}
          {area.coverage.total_overlap_land_area_m2.toLocaleString()} m² weighted land overlap
        </p>
      )}
    </div>
  )
}
