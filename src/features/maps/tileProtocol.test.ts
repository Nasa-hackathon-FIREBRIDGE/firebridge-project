import { describe, expect, it, vi } from 'vitest'
import { addProtocol } from 'maplibre-gl'
import { CanceledError } from 'axios'
import { analyses } from '../../services/analyses.service'
import { registerTileProtocol } from './tileProtocol'
vi.mock('maplibre-gl', () => ({ addProtocol: vi.fn() }))

describe('MapLibre API protocol', () => {
  it('registers once, uses the existing API service and propagates cancellation/errors', async () => {
    registerTileProtocol()
    registerTileProtocol()
    expect(addProtocol).toHaveBeenCalledTimes(1)
    const loader = vi.mocked(addProtocol).mock.calls[0][1]
    const controller = new AbortController()
    const bytes = new ArrayBuffer(0)
    const tile = vi.spyOn(analyses, 'tile').mockResolvedValue(bytes)
    const id = '22222222-2222-4222-8222-222222222222'
    const params = { url: `firebridge://tiles/${id}/detections/0/0/0.mvt` }
    expect((await loader(params, controller)).data).toBe(bytes)
    expect(tile).toHaveBeenCalledWith(
      { id, layer: 'detections', z: 0, x: 0, y: 0 },
      controller.signal,
    )
    await expect(
      loader({ url: params.url.replace('detections', 'unknown') }, controller),
    ).rejects.toMatchObject({ status: 400 })
    tile.mockRejectedValue(new Error('Unavailable'))
    await expect(loader(params, controller)).rejects.toThrow('Unavailable')
    const cancelled = new CanceledError('Cancelled')
    Object.assign(cancelled, { config: { headers: Object.create(null) } })
    tile.mockRejectedValue(cancelled)
    controller.abort()
    const error = await loader(
      { url: 'firebridge://tiles/22222222-2222-4222-8222-222222222222/detections/0/0/0.mvt' },
      controller,
    ).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype)
    expect(error).toMatchObject({ name: 'AbortError' })
    expect(error).not.toHaveProperty('config')
    tile.mockRestore()
  })
})
