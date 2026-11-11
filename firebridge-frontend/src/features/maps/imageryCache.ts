import { addProtocol } from 'maplibre-gl'

const PROTOCOL = 'firebridge-imagery'
const CACHE_NAME = 'firebridge-imagery-v1'
const MAX_TILES = 4000

/**
 * NASA GIBS answers every tile with `Cache-Control: no-store`, so the browser would fetch the same
 * archival imagery again on every visit. Tiles requested through this protocol are kept in Cache Storage.
 */
export const cachedImagery = (url: string) => url.replace(/^https:\/\//, `${PROTOCOL}://`)

let opened: Promise<Cache | null> | null = null
function imageryCache(): Promise<Cache | null> {
  // Cache Storage only exists in secure contexts; without it tiles are fetched as usual.
  opened ??= typeof caches === 'undefined'
    ? Promise.resolve(null)
    : caches.open(CACHE_NAME).then(async (cache) => {
      const keys = await cache.keys()
      // Keys come back in insertion order, so the oldest quarter goes once the cache is full.
      if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - Math.floor(MAX_TILES * 0.75)).map((key) => cache.delete(key)))
      return cache
    }).catch(() => null)
  return opened
}

export async function loadImageryTile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const source = url.replace(`${PROTOCOL}://`, 'https://')
  const cache = await imageryCache()
  const hit = await cache?.match(source).catch(() => undefined)
  if (hit) return hit.arrayBuffer()
  const response = await fetch(source, { signal })
  if (!response.ok) throw new Error(`Imagery tile request failed (${response.status}).`)
  const data = await response.arrayBuffer()
  void cache?.put(source, new Response(data.slice(0), { headers: { 'content-type': response.headers.get('content-type') ?? 'image/jpeg' } })).catch(() => {})
  return data
}

let registered = false
export function registerImageryProtocol() {
  if (registered) return
  addProtocol(PROTOCOL, async ({ url }, controller) => ({ data: await loadImageryTile(url, controller.signal) }))
  registered = true
}
