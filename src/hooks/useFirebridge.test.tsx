// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { CanceledError } from 'axios'
import type { ReactNode } from 'react'
import api from '../lib/axios'
import { queryClient } from '../lib/queryClient'
import { useArea, useCreateArea } from './useFirebridge'
const original = api.defaults.adapter
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
afterEach(() => { cleanup(); queryClient.clear(); api.defaults.adapter = original })
describe('React Query API hooks', () => {
  it('deduplicates readers and invalidates only the area affected by a mutation', async () => {
    const counts: Record<string, number> = {}
    api.defaults.adapter = async (config) => {
      const key = config.method + ' ' + config.url; counts[key] = (counts[key] ?? 0) + 1
      return { config, status: 200, statusText: 'OK', headers: {}, data: { schema_version: '1', request_id: 'test', warnings: [], data: { id: config.method === 'post' ? 'a' : config.url!.split('/').pop() } } }
    }
    const hook = renderHook(() => ({ a: useArea('a'), secondA: useArea('a'), b: useArea('b'), create: useCreateArea() }), { wrapper })
    await waitFor(() => expect(hook.result.current.a.isSuccess && hook.result.current.b.isSuccess).toBe(true))
    expect(counts['get /areas/a']).toBe(1)
    await act(async () => { await hook.result.current.create.mutateAsync({ name: 'Test', version: '1', display_timezone: 'UTC', provenance: 'test', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[0,1],[0,0]]] } }) })
    expect(counts['get /areas/a']).toBe(2); expect(counts['get /areas/b']).toBe(1)
  })
  it('does not request an absent ID and cancels the query when its observer unmounts', async () => {
    let calls = 0; let cancelled = false
    api.defaults.adapter = (config) => new Promise((_resolve, reject) => {
      calls++; config.signal!.addEventListener!('abort', () => { cancelled = true; reject(new CanceledError()) })
    })
    const disabled = renderHook(() => useArea(undefined), { wrapper }); expect(calls).toBe(0); disabled.unmount()
    const active = renderHook(() => useArea('a'), { wrapper })
    await waitFor(() => expect(calls).toBe(1)); active.unmount()
    expect(cancelled).toBe(true)
  })
})
