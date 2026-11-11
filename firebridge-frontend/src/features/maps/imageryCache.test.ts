import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('maplibre-gl', () => ({ addProtocol: vi.fn() }))

const TILE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/6/26/31.jpeg'

class MemoryCache {
  store = new Map<string, Response>()
  async match(url: string) { return this.store.get(url)?.clone() }
  async put(url: string, response: Response) { this.store.set(url, response) }
  async keys() { return [...this.store.keys()].map((url) => new Request(url)) }
  async delete(key: Request) { return this.store.delete(key.url) }
}

const load = async () => (await import('./imageryCache'))
const signal = () => new AbortController().signal

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('imagery cache', () => {
  it('fetches a tile from NASA once, then serves it from the browser cache', async () => {
    const cache = new MemoryCache()
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { cachedImagery, loadImageryTile } = await load()

    const url = cachedImagery(TILE)
    expect(url.startsWith('firebridge-imagery://gibs.earthdata.nasa.gov/')).toBe(true)
    expect(new Uint8Array(await loadImageryTile(url, signal()))).toEqual(new Uint8Array([1, 2, 3]))
    await vi.waitFor(() => expect(cache.store.has(TILE)).toBe(true))
    expect(new Uint8Array(await loadImageryTile(url, signal()))).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(TILE, expect.anything())
  })

  it('still loads tiles where Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined)
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([9])))
    vi.stubGlobal('fetch', fetchMock)
    const { cachedImagery, loadImageryTile } = await load()
    await loadImageryTile(cachedImagery(TILE), signal())
    await loadImageryTile(cachedImagery(TILE), signal())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports a failed tile so the map can retry, and never caches it', async () => {
    const cache = new MemoryCache()
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })))
    const { cachedImagery, loadImageryTile } = await load()
    await expect(loadImageryTile(cachedImagery(TILE), signal())).rejects.toThrow('503')
    expect(cache.store.size).toBe(0)
  })

  it('drops the oldest tiles once the cache holds more than it should', async () => {
    const cache = new MemoryCache()
    for (let index = 0; index < 4001; index += 1) cache.store.set(`https://example.test/${index}`, new Response(''))
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))))
    const { cachedImagery, loadImageryTile } = await load()
    await loadImageryTile(cachedImagery(TILE), signal())
    expect(cache.store.has('https://example.test/0')).toBe(false)
    expect(cache.store.has('https://example.test/4000')).toBe(true)
    await vi.waitFor(() => expect(cache.store.size).toBe(3000 + 1)) // three quarters kept, plus the new tile
  })
})
