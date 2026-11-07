// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import api from '../lib/axios'
import { apiKeys } from '../services/api.keys'
import { useCreateExplanation, useDetections, useReports } from './useDataApi'
import { useIntentKey } from './useIntentKey'
const original = api.defaults.adapter
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
afterEach(() => { cleanup(); client.clear(); api.defaults.adapter = original })
describe('Data query cache and mutation intent', () => {
  it('deduplicates an identical page while separating analysis IDs, filters and cursors', async () => {
    const calls: string[] = []
    api.defaults.adapter = async (config) => {
      calls.push(config.url + JSON.stringify(config.params))
      return { config, status: 200, statusText: 'OK', headers: {}, data: { schema_version: '1', request_id: 'r', warnings: [], data: { next_cursor: null } } }
    }
    const hook = renderHook(() => ({
      a: useDetections('a', { limit: 1 }), same: useDetections('a', { limit: 1 }),
      b: useDetections('b', { limit: 1 }), cursor: useDetections('a', { limit: 1, cursor: 'page2' }),
      filtered: useDetections('a', { limit: 1, source_ids: 'terra' }), disabled: useReports(''),
    }), { wrapper })
    await waitFor(() => expect(hook.result.current.a.isSuccess && hook.result.current.b.isSuccess && hook.result.current.cursor.isSuccess && hook.result.current.filtered.isSuccess).toBe(true))
    expect(calls).toHaveLength(4)
    expect(hook.result.current.disabled.fetchStatus).toBe('idle')
    expect(apiKeys.admin('session', 'gaps', { limit: 1 })).not.toEqual(apiKeys.admin('other', 'gaps', { limit: 1 }))
  })
  it('keeps an idempotency key for an explicit retry and changes it when the intent changes', () => {
    const hook = renderHook(() => useIntentKey(), { wrapper })
    const first = hook.result.current({ analysis: 'a', input: { language: 'fr' } })
    hook.rerender()
    expect(hook.result.current({ analysis: 'a', input: { language: 'fr' } })).toBe(first)
    expect(hook.result.current({ analysis: 'a', input: { language: 'en' } })).not.toBe(first)
  })
  it('does not retry a timed-out mutation automatically', async () => {
    let calls = 0
    api.defaults.adapter = async () => { calls++; throw new Error('timeout') }
    const hook = renderHook(() => useCreateExplanation(), { wrapper })
    await act(async () => { try { await hook.result.current.mutateAsync({ analysisId: 'a', input: { language: 'fr' }, idempotencyKey: 'same-key' }) } catch { /* expected */ } })
    expect(calls).toBe(1)
  })
})

