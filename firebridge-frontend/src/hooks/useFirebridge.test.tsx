// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, CanceledError } from 'axios'
import type { ReactNode } from 'react'
import api from '../lib/axios'
import { queryClient } from '../lib/queryClient'
import { useAnalysis, useArea, useCreateArea, useJob } from './useFirebridge'
import { analysisFixture, areaFixture, envelope, jobFixture } from '../services/test-fixtures'
import { resultFixtures } from '../services/results.test-fixtures'
import { useNativeSummary } from '../features/observations/useResults'
const original = api.defaults.adapter
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)
afterEach(() => {
  cleanup()
  queryClient.clear()
  api.defaults.adapter = original
  vi.useRealTimers()
})
describe('React Query API hooks', () => {
  it.each([true, false])(
    'refreshes result readers only when the cached analysis was active: %s',
    async (active) => {
      queryClient.setQueryData(['firebridge', 'analysis', 'analysis'], {
        ...analysisFixture,
        status: 'partial',
        job: { ...analysisFixture.job, status: active ? 'running' : 'partial' },
      })
      queryClient.setQueryData(
        ['firebridge', 'results', 'analysis', 'summary'],
        resultFixtures.summary,
      )
      let summaryReads = 0
      api.defaults.adapter = async (config) => {
        const summary = config.url?.endsWith('/summary')
        if (summary) summaryReads++
        return {
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: envelope(
            summary
              ? resultFixtures.summary
              : { ...jobFixture, kind: 'analysis', status: 'partial' },
          ),
        }
      }
      const hook = renderHook(
        () => ({ summary: useNativeSummary('analysis'), job: useJob('job') }),
        { wrapper },
      )
      await waitFor(() => expect(hook.result.current.job.isSuccess).toBe(true))
      await waitFor(() => expect(hook.result.current.summary.isFetching).toBe(false))
      expect(summaryReads).toBe(active ? 1 : 0)
      expect(queryClient.getQueryState(['firebridge', 'analysis', 'analysis'])?.isInvalidated).toBe(
        active,
      )
    },
  )
  it('deduplicates readers and invalidates only the area affected by a mutation', async () => {
    const counts: Record<string, number> = {}
    api.defaults.adapter = async (config) => {
      const key = config.method + ' ' + config.url
      counts[key] = (counts[key] ?? 0) + 1
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {
          schema_version: '1',
          request_id: 'test',
          warnings: [],
          data: {
            ...areaFixture,
            id: config.method === 'post' ? 'a' : config.url!.split('/').pop(),
          },
        },
      }
    }
    const hook = renderHook(
      () => ({ a: useArea('a'), secondA: useArea('a'), b: useArea('b'), create: useCreateArea() }),
      { wrapper },
    )
    await waitFor(() =>
      expect(hook.result.current.a.isSuccess && hook.result.current.b.isSuccess).toBe(true),
    )
    expect(counts['get /areas/a']).toBe(1)
    await act(async () => {
      await hook.result.current.create.mutateAsync({
        name: 'Test',
        version: '1',
        display_timezone: 'UTC',
        provenance: 'test',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      })
    })
    expect(counts['get /areas/a']).toBe(2)
    expect(counts['get /areas/b']).toBe(1)
  })
  it('does not request an absent ID and cancels the query when its observer unmounts', async () => {
    let calls = 0
    let cancelled = false
    api.defaults.adapter = (config) =>
      new Promise((_resolve, reject) => {
        calls++
        config.signal!.addEventListener!('abort', () => {
          cancelled = true
          reject(new CanceledError())
        })
      })
    const disabled = renderHook(() => useArea(undefined), { wrapper })
    expect(calls).toBe(0)
    disabled.unmount()
    const active = renderHook(() => useArea('a'), { wrapper })
    await waitFor(() => expect(calls).toBe(1))
    active.unmount()
    expect(cancelled).toBe(true)
  })
  it.each(['succeeded', 'partial', 'failed', 'cancelled'] as const)(
    'polls a running job then stops at %s',
    async (status) => {
      let calls = 0
      api.defaults.adapter = async (config) => {
        calls++
        return {
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: envelope({
            ...jobFixture,
            analysis_id: null,
            status: calls === 1 ? 'running' : status,
          }),
        }
      }
      vi.useFakeTimers()
      const hook = renderHook(() => ({ ...useJob('job') }), { wrapper })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(hook.result.current.data?.status).toBe('running')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100)
      })
      expect(hook.result.current.data?.status).toBe(status)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(calls).toBe(2)
    },
  )
  it('stops polling stale running data after a terminal HTTP error', async () => {
    let calls = 0
    api.defaults.adapter = async (config) => {
      if (++calls > 1)
        throw new AxiosError('Missing', 'ERR_BAD_RESPONSE', config, undefined, {
          config,
          status: 404,
          statusText: 'Missing',
          headers: {},
          data: { code: 'NOT_FOUND', message: 'Missing' },
        })
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: envelope({ ...jobFixture, analysis_id: null, status: 'running' }),
      }
    }
    vi.useFakeTimers()
    const hook = renderHook(() => ({ ...useJob('job') }), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(hook.result.current.data?.status).toBe('running')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(hook.result.current.isError).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(calls).toBe(2)
  })
  it('continues observing partial analysis while its job runs and stops when it finishes', async () => {
    let calls = 0
    api.defaults.adapter = async (config) => {
      calls++
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: envelope({
          ...analysisFixture,
          status: 'partial',
          job: { ...analysisFixture.job, status: calls === 1 ? 'running' : 'partial' },
        }),
      }
    }
    vi.useFakeTimers()
    const hook = renderHook(() => useAnalysis('analysis'), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(hook.result.current.data?.job?.status).toBe('running')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(hook.result.current.data?.job?.status).toBe('partial')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(calls).toBe(2)
  })
})
