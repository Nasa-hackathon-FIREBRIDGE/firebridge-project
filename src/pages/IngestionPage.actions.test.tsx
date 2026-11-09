// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import api from '../lib/axios'
import IngestionPage from './IngestionPage'
import { envelope, jobFixture } from '../services/test-fixtures'

const original = api.defaults.adapter
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
afterEach(() => { cleanup(); client.clear(); api.defaults.adapter = original })

it('selects a subscription without posting, validates its window, follows its plan job and clears the admin cache', async () => {
  const subscription = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const job = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const token = 'private-test-token-never-persisted'
  const posts: object[] = []
  api.defaults.adapter = async (config) => {
    const post = config.method === 'post'
    if (post) posts.push(JSON.parse(config.data))
    const data = post
      ? { job_id: job, status: 'queued', execution_support: 'planning_only', planned_chunks: 1, estimated_bytes: null, missing_access_requirements: [], reused: false }
      : config.url?.startsWith('/jobs/')
        ? { ...jobFixture, id: job, kind: 'ingestion_plan', status: 'succeeded', current_stage: 'awaiting_fetch_executor', download_url: null }
        : config.url?.endsWith('/subscriptions')
          ? { subscriptions: [{ id: subscription, feed_id: 'test-feed', scope_key: 'test-scope' }], next_cursor: null }
          : { gaps: [], next_cursor: null }
    return { config, status: post ? 202 : 200, statusText: 'OK', headers: {}, data: envelope(data) }
  }
  render(<QueryClientProvider client={client}><MemoryRouter><IngestionPage /></MemoryRouter></QueryClientProvider>)
  fireEvent.change(screen.getByLabelText('Jeton d’administration'), { target: { value: token } })
  fireEvent.click(screen.getByRole('button', { name: 'Accéder à l’administration' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Préparer l’actualisation' }))
  expect((screen.getByLabelText('Souscription (UUID)') as HTMLInputElement).value).toBe(subscription)
  expect(posts).toHaveLength(0)

  const section = document.getElementById('ingestion-refresh')!
  fireEvent.change(within(section).getByLabelText('Début UTC (ISO 8601)'), { target: { value: '2024-01-17T00:00:00Z' } })
  fireEvent.submit(section.querySelector('form')!)
  await screen.findByText('Renseigner un début et une fin ISO 8601 avec fuseau, par exemple 2024-01-17T00:00:00Z.')
  expect(posts).toHaveLength(0)
  fireEvent.change(within(section).getByLabelText('Fin exclusive UTC (ISO 8601)'), { target: { value: '2024-01-20T00:00:00Z' } })
  fireEvent.submit(section.querySelector('form')!)
  await screen.findByRole('heading', { name: 'Suivi de la planification' })
  await screen.findByText('awaiting_fetch_executor')
  expect(posts).toHaveLength(1)
  expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain(token)
  expect(client.getQueryCache().getAll().some((query) => query.queryKey.includes('plan-job'))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Fermer la session et effacer les résultats d’administration' }))
  await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0))
  expect((screen.getByLabelText('Jeton d’administration') as HTMLInputElement).value).toBe('')
})
