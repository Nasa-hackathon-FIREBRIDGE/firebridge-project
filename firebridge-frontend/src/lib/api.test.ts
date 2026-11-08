import { afterEach, describe, expect, it } from 'vitest'
import { AxiosError, CanceledError, type AxiosAdapter } from 'axios'
import api, { ApiClientError, unwrap } from './axios'
import { parseApiUrl } from '../config/env'
import { queryClient, retryApiQuery } from './queryClient'
import { apiKeys } from '../services/api.keys'
const original = api.defaults.adapter
afterEach(() => { api.defaults.adapter = original; queryClient.clear() })
describe('Public HTTP client and cache', () => {
  it('defaults missing Vite configuration and rejects credentials or a wrong prefix', () => {
    expect(parseApiUrl(undefined)).toBe('http://localhost:3000/api/v1')
    for (const input of ['file:///api/v1', 'http://user:password@localhost/api/v1', 'http://localhost/api', 'http://localhost/api/v1?key=x']) expect(() => parseApiUrl(input)).toThrow()
  })
  it('shares one in-flight query and sends no identity, auth header or cookies', async () => {
    let calls = 0
    api.defaults.adapter = (async (config) => {
      calls++; expect(config.headers.has('Authorization')).toBe(false); expect(config.withCredentials).toBe(false)
      await new Promise((done) => setTimeout(done, 10))
      return { status: 200, statusText: 'OK', headers: {}, config, data: { schema_version: '1', request_id: 'test', warnings: [], data: { id: 'area' } } }
    }) satisfies AxiosAdapter
    const options = { queryKey: apiKeys.area('area'), queryFn: async ({ signal }: { signal: AbortSignal }) => unwrap((await api.get('/areas/area', { signal })).data) }
    const result = await Promise.all([queryClient.fetchQuery(options), queryClient.fetchQuery(options)])
    expect(calls).toBe(1); expect(result[0]).toEqual(result[1])
  })
  it('keeps cancellations distinct from API, network and binary JSON errors', async () => {
    api.defaults.adapter = async () => { throw new CanceledError() }
    await expect(api.get('/health/live')).rejects.toBeInstanceOf(CanceledError)
    api.defaults.adapter = async (config) => { throw new AxiosError('network', 'ERR_NETWORK', config) }
    await expect(api.get('/health/live')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    api.defaults.adapter = async (config) => { throw new AxiosError('bad', 'ERR_BAD_RESPONSE', config, undefined, { status: 409, statusText: 'Conflict', config, headers: {}, data: new TextEncoder().encode(JSON.stringify({ code: 'CONFLICT', message: 'Pending', request_id: 'r' })).buffer }) }
    await expect(api.get('/jobs/x/download', { responseType: 'arraybuffer' })).rejects.toMatchObject({ code: 'CONFLICT', status: 409, requestId: 'r' })
  })
  it('does not retry invalid responses, cancellation or terminal HTTP errors', () => {
    expect(retryApiQuery(0, new ApiClientError('bad', 'INVALID_RESPONSE'))).toBe(false)
    expect(retryApiQuery(0, new ApiClientError('missing', 'NOT_FOUND', 404))).toBe(false)
    expect(retryApiQuery(0, new ApiClientError('offline', 'NETWORK_ERROR'))).toBe(true)
    expect(retryApiQuery(2, new ApiClientError('offline', 'NETWORK_ERROR'))).toBe(false)
    expect(() => unwrap({} as never)).toThrow('Unexpected API response')
  })
})
