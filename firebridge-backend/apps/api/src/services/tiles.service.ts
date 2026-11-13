import { createHash } from 'node:crypto';
import { resultsConfig, type ResultContext } from '@firebridge/results';
import { redis, ensureRedisConnected } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { ServiceUnavailableError } from '../errors/app-error.js';
import type { TileParams } from '../validators/results.validator.js';
import { tileLayers } from './tile-layers.js';

export function tileCacheKey(params: TileParams, context: ResultContext): string {
  const version = createHash('sha256').update(JSON.stringify([
    context.cache_key, context.release_id, context.completed_at, context.status
  ])).digest('hex');
  return `phase4:tile:v1:${params.id}:${version}:${params.layer}:${params.z}:${params.x}:${params.y}`;
}

export const tilesService = {
  async get(params: TileParams, context: ResultContext, observe?: (state: 'HIT' | 'MISS') => void): Promise<Buffer> {
    const key = tileCacheKey(params, context);
    try {
      await ensureRedisConnected();
      const cached = await redis.getBuffer(key);
      if (cached) { observe?.('HIT'); return cached; }
    } catch {
      logger.warn('Tile cache unavailable');
    }
    const tile = await tileLayers[params.layer].generate(params);
    observe?.('MISS');
    if (tile.length > resultsConfig.TILE_MAX_BYTES) throw new ServiceUnavailableError('Tile size limit exceeded.');
    try {
      await redis.set(key, tile, 'EX', resultsConfig.TILE_CACHE_SECONDS);
    } catch {
      logger.warn('Tile cache write failed');
    }
    return tile;
  }
};
