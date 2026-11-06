import { useId, type ReactNode } from 'react'
import { displayValue } from './format'
import type { useCursorPage } from '../../hooks/useCursorPage'
import type { UseQueryResult } from '@tanstack/react-query'
import { ApiClientError } from '../../lib/axios'
import type { Resource } from '../../services/resource'

export function ApiErrorMessage({ error }: { error: Error | null }) {
  if (!error) return null
  return <p role="alert" className="api-error">{error.message}
    {error instanceof ApiClientError && <> <strong>({error.code})</strong>{error.requestId && <small>Requête : {error.requestId}</small>}</>}
  </p>
}
export function ResourcePanel<T>({ title, query, children }: {
  title: string; query: UseQueryResult<Resource<T>, Error>; children: (data: T) => ReactNode
}) {
  const status = query.data?.data && typeof query.data.data === 'object' && 'status' in query.data.data
    ? String(query.data.data.status) : null
  return <section className="panel api-section" aria-label={title}>
    <div className="panel-heading"><h2>{title}</h2><button type="button" className="button button-secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser</button></div>
    {query.isPending && !query.isError && <p role="status">Chargement…</p>}
    {query.isFetching && !query.isPending && <p role="status">Actualisation…</p>}
    <ApiErrorMessage error={query.error} />
    {query.data && <>
      {status && <p>État des données : <strong>{status}</strong></p>}
      {query.data.warnings.length > 0 && <div role="note"><strong>Avertissements de l’API</strong><ul>{query.data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      {children(query.data.data)}
    </>}
  </section>
}
export function Facts({ values }: { values: Record<string, unknown> }) {
  return <dl className="api-facts">{Object.entries(values).map(([key, value]) =>
    <div key={key}><dt>{key}</dt><dd>{value !== null && typeof value === 'object' ? <StructuredValue value={value} /> : displayValue(value)}</dd></div>)}</dl>
}
export function Records({ rows, empty = 'Aucun enregistrement pour cette sélection.' }: { rows: object[]; empty?: string }) {
  if (!rows.length) return <p>{empty}</p>
  const keys = [...new Set(rows.flatMap(Object.keys))]
  return <div className="api-table-wrap"><table className="api-table"><thead><tr>{keys.map((key) => <th key={key} scope="col">{key.replaceAll('_', ' ')}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{keys.map((key) => {
      const value = (row as Record<string, unknown>)[key]
      return <td key={key}>{value !== null && typeof value === 'object'
        ? <details><summary>Voir les détails</summary><StructuredValue value={value} /></details> : displayValue(value)}</td>
    })}</tr>)}</tbody></table></div>
}
export function StructuredValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return value.length && value.every((v) => v && typeof v === 'object' && !Array.isArray(v))
    ? <Records rows={value} /> : <ul>{value.map((v, i) => <li key={i}><StructuredValue value={v} /></li>)}</ul>
  if (value !== null && typeof value === 'object') return <dl className="api-facts">{Object.entries(value).map(([key, val]) =>
    <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd><StructuredValue value={val} /></dd></div>)}</dl>
  return <>{displayValue(value)}</>
}
export function Limitations({ data }: { data: { reasons?: string[]; limitations?: string[] } }) {
  const notes = [...new Set([...(data.reasons ?? []), ...(data.limitations ?? [])])]
  return notes.length ? <details className="api-notes" open><summary>Limites et interprétation</summary><ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul></details> : null
}
export function Pager({ page, next }: { page: ReturnType<typeof useCursorPage>; next?: string | null }) {
  return <div className="api-actions"><button type="button" className="button button-secondary" disabled={page.first} onClick={page.back}>Page précédente</button>
    <button type="button" className="button button-secondary" disabled={!next} onClick={() => { if (next) page.next(next) }}>Page suivante</button></div>
}
export interface FilterField<T> {
  name: keyof T & string; label: string; options?: readonly string[]
  type?: 'text' | 'date' | 'number'; min?: number; max?: number; value?: string | number
}
export function Filters<T extends object>({ fields, onApply }: { fields: FilterField<T>[]; onApply: (params: T) => void }) {
  const id = useId()
  return <form className="api-form api-filters" onSubmit={(event) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const params = Object.fromEntries(fields.flatMap((field) => {
      const value = String(data.get(field.name) ?? '').trim()
      return value ? [[field.name, field.type === 'number' ? Number(value) : value]] : []
    })) as T
    onApply(params)
  }}>
    {fields.map((field) => <label key={field.name} htmlFor={id + field.name}>{field.label}
      {field.options ? <select id={id + field.name} name={field.name} defaultValue={field.value ?? ''}>
        <option value="">Valeur par défaut</option>{field.options.map((value) => <option key={value} value={value}>{value}</option>)}
      </select> : <input id={id + field.name} name={field.name} type={field.type ?? 'text'} defaultValue={field.value ?? ''} min={field.min} max={field.max} />}
    </label>)}
    <button className="button button-primary">Appliquer les filtres</button>
  </form>
}

