import { useId, useMemo, useState, type ReactNode } from 'react'
import { displayValue } from './format'
import type { useCursorPage } from '../../hooks/useCursorPage'
import type { UseQueryResult } from '@tanstack/react-query'
import { FeedbackMessage } from '../FeedbackMessage'
import type { Operation } from '../../lib/userFeedback'
import type { Resource } from '../../services/resource'

export function ApiErrorMessage({
  error,
  operation = 'read',
}: {
  error: Error | null
  operation?: Operation
}) {
  return <FeedbackMessage error={error} operation={operation} />
}
export function ResourcePanel<T>({
  title,
  query,
  children,
}: {
  title: string
  query: UseQueryResult<Resource<T>, Error>
  children: (data: T) => ReactNode
}) {
  const status =
    query.data?.data && typeof query.data.data === 'object' && 'status' in query.data.data
      ? String(query.data.data.status)
      : null
  return (
    <section className="panel api-section" aria-label={title}>
      <div className="panel-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="button button-secondary"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Actualiser
        </button>
      </div>
      {query.isPending && !query.isError && <p role="status">Chargement…</p>}
      {query.isFetching && !query.isPending && <p role="status">Actualisation…</p>}
      <FeedbackMessage
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
      {query.data && (
        <>
          {status && (
            <p>
              État des données : <strong>{status}</strong>
            </p>
          )}
          {query.data.warnings.length > 0 && (
            <div role="note">
              <strong>Avertissements de l’API</strong>
              <ul>
                {query.data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {children(query.data.data)}
        </>
      )}
    </section>
  )
}
export function Facts({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="api-facts">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {value !== null && typeof value === 'object' ? (
              <StructuredValue value={value} />
            ) : (
              displayValue(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
export function Records<T extends object>({
  rows,
  empty = 'Aucun enregistrement pour cette sélection.',
  rowActions,
}: {
  rows: T[]
  empty?: string
  rowActions?: (row: T) => ReactNode
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null)
  const [dense, setDense] = useState(true)
  const [hidden, setHidden] = useState<string[]>([])
  const keys = useMemo(() => [...new Set(rows.flatMap(Object.keys))], [rows])
  const visible = keys.filter((key) => !hidden.includes(key))
  const displayed = useMemo(() => {
    const records = rows.filter((row) => !search || Object.values(row).some((value) => value != null && (typeof value === 'object' ? JSON.stringify(value) : String(value)).toLowerCase().includes(search.toLowerCase())))
    if (sort) records.sort((a, b) => {
      const left = (a as Record<string, unknown>)[sort.key], right = (b as Record<string, unknown>)[sort.key]
      if (left == null) return right == null ? 0 : 1
      if (right == null) return -1
      const comparison = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true })
      return comparison * (sort.descending ? -1 : 1)
    })
    return records
  }, [rows, search, sort])
  if (!rows.length) return <p>{empty}</p>
  return (
    <div className="platform-records">
      <div className="platform-table-tools"><label><span className="sr-only">Search this loaded table</span><input type="search" aria-label="Search this loaded table" placeholder="Search loaded records…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <span>{displayed.length} / {rows.length} loaded</span><button type="button" className="button button-secondary" aria-pressed={dense} onClick={() => setDense(!dense)}>{dense ? 'Compact rows' : 'Comfortable rows'}</button>
        <details><summary>Columns</summary><div className="platform-column-picker">{keys.map((key) => <label key={key}><input type="checkbox" checked={!hidden.includes(key)} disabled={!hidden.includes(key) && visible.length === 1} onChange={() => setHidden((value) => value.includes(key) ? value.filter((item) => item !== key) : [...value, key])} />{key.replaceAll('_', ' ')}</label>)}</div></details>
      </div>
    <div className={`api-table-wrap ${dense ? 'platform-table-dense' : ''}`}>
      <table className="api-table">
        <thead>
          <tr>
            {visible.map((key) => (
              <th key={key} scope="col" aria-sort={sort?.key === key ? sort.descending ? 'descending' : 'ascending' : 'none'}>
                <button type="button" className="platform-sort-column" onClick={() => setSort({ key, descending: sort?.key === key ? !sort.descending : false })}>{key.replaceAll('_', ' ')} <span aria-hidden="true">{sort?.key === key ? sort.descending ? '↓' : '↑' : '↕'}</span></button>
              </th>
            ))}
            {rowActions && <th scope="col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {displayed.map((row, index) => (
            <tr key={index}>
              {visible.map((key) => {
                const value = (row as Record<string, unknown>)[key]
                return (
                  <td key={key}>
                    {value !== null && typeof value === 'object' ? (
                      <details>
                        <summary>Voir les détails</summary>
                        <StructuredValue value={value} />
                      </details>
                    ) : typeof value === 'string' && value.length > 120 ? (
                      <details className="platform-cell-details"><summary title={value}>{value.slice(0, 65)}… <span>Full value</span></summary><p>{value}</p></details>
                    ) : (
                      displayValue(value)
                    )}
                  </td>
                )
              })}
              {rowActions && <td>{rowActions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {displayed.length === 0 && <p role="status">No loaded records match this search.</p>}
    <p className="platform-table-scope">Search, sort and density apply to this loaded table. Use server pagination to inspect more records.</p>
    </div>
  )
}
export function StructuredValue({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return value.length && value.every((v) => v && typeof v === 'object' && !Array.isArray(v)) ? (
      <Records rows={value} />
    ) : (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <StructuredValue value={v} />
          </li>
        ))}
      </ul>
    )
  if (value !== null && typeof value === 'object')
    return (
      <dl className="api-facts">
        {Object.entries(value).map(([key, val]) => (
          <div key={key}>
            <dt>{key.replaceAll('_', ' ')}</dt>
            <dd>
              <StructuredValue value={val} />
            </dd>
          </div>
        ))}
      </dl>
    )
  return <>{displayValue(value)}</>
}
export function Limitations({ data }: { data: { reasons?: string[]; limitations?: string[] } }) {
  const notes = [...new Set([...(data.reasons ?? []), ...(data.limitations ?? [])])]
  return notes.length ? (
    <details className="api-notes" open>
      <summary>Limites et interprétation</summary>
      <ul>
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </details>
  ) : null
}
export function Pager({
  page,
  next,
}: {
  page: ReturnType<typeof useCursorPage>
  next?: string | null
}) {
  return (
    <div className="api-actions">
      <button
        type="button"
        className="button button-secondary"
        disabled={page.first}
        onClick={page.back}
      >
        Page précédente
      </button>
      <button
        type="button"
        className="button button-secondary"
        disabled={!next}
        onClick={() => {
          if (next) page.next(next)
        }}
      >
        Page suivante
      </button>
    </div>
  )
}
export interface FilterField<T> {
  name: keyof T & string
  label: string
  options?: readonly string[]
  type?: 'text' | 'date' | 'number'
  min?: number
  max?: number
  value?: string | number
}
export function Filters<T extends object>({
  fields,
  onApply,
}: {
  fields: FilterField<T>[]
  onApply: (params: T) => void
}) {
  const id = useId()
  return (
    <form
      className="api-form api-filters"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const params = Object.fromEntries(
          fields.flatMap((field) => {
            const value = String(data.get(field.name) ?? '').trim()
            return value ? [[field.name, field.type === 'number' ? Number(value) : value]] : []
          }),
        ) as T
        onApply(params)
      }}
    >
      {fields.map((field) => (
        <label key={field.name} htmlFor={id + field.name}>
          {field.label}
          {field.options ? (
            <select id={id + field.name} name={field.name} defaultValue={field.value ?? ''}>
              <option value="">Valeur par défaut</option>
              {field.options.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={id + field.name}
              name={field.name}
              type={field.type ?? 'text'}
              defaultValue={field.value ?? ''}
              min={field.min}
              max={field.max}
            />
          )}
        </label>
      ))}
      <button className="button button-primary">Appliquer les filtres</button>
    </form>
  )
}
