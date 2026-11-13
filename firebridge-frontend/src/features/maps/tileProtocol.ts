import { addProtocol } from 'maplibre-gl'
import { isCancel } from 'axios'
import { analyses } from '../../services/analyses.service'
import { ApiClientError } from '../../lib/axios'

let registered = false
export function registerTileProtocol() {
  if (registered) return
  addProtocol('firebridge', async ({ url }, controller) => {
    const match =
      /^firebridge:\/\/tiles\/([a-f0-9-]+)\/detections\/(\d+)\/(\d+)\/(\d+)\.mvt$/i.exec(url)
    if (!match) throw new ApiClientError('Invalid analysis tile URL.', 'VALIDATION_ERROR', 400)
    const [, id, z, x, y] = match
    try {
      return {
        data: await analyses.tile(
          { id, layer: 'detections', z: Number(z), x: Number(x), y: Number(y) },
          controller.signal,
        ),
      }
    } catch (error) {
      if (!controller.signal.aborted && !isCancel(error)) throw error
      // MapLibre transfers errors across its worker boundary. Axios cancellation
      // objects carry request configuration that its serializer cannot transfer.
      const aborted = new Error('Tile request cancelled.')
      aborted.name = 'AbortError'
      throw aborted
    }
  })
  registered = true
}
