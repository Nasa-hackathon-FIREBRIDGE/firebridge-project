import { tilesRepository } from '../repositories/tiles.repository.js';
import type { TileParams } from '../validators/results.validator.js';

// Registry contains code-owned query functions, never interpolated identifiers.
export const tileLayers = Object.freeze({
  detections: Object.freeze({
    id: 'detections',
    source: 'firebridge.detections via release_partitions/partition_detections',
    columns: ['count', 'frp_mw'] as const,
    spatial: 'AOI intersection; XYZ envelope; Web Mercator; point quantization',
    aggregation: 'All zooms: count and maximum FRP per 1/64 tile world-grid cell',
    access: 'Public endpoint; published satellite component; ready/partial UTC native analysis',
    generate: (params: TileParams) => tilesRepository.detections(params)
  })
});
