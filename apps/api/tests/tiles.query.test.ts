import { describe, expect, it } from 'vitest';
import { detectionTileSql } from '../src/repositories/tiles.repository.js';
import { detectionSelection } from '@firebridge/results';
import { tileCacheKey } from '../src/services/tiles.service.js';

const params = { id: '33333333-3333-4333-8333-333333333333', layer: 'detections' as const, z: 4, x: 1, y: 2 };
describe('Parameterized tile query and cache versions', () => {
  it('bounds the SQL spatially and aggregates every matching detection without LIMIT or SELECT *', () => {
    const sql = detectionTileSql(params);
    expect(sql.text).toContain('ST_TileEnvelope');
    expect(sql.text).toContain('ST_AsMVTGeom');
    expect(sql.text).toContain('ST_AsMVT');
    expect(sql.text).toContain('d.geom &&');
    expect(sql.text).toContain('ST_Intersects');
    expect(sql.text).toContain('ST_SnapToGrid');
    expect(sql.text).toContain('GROUP BY');
    expect(sql.text).not.toContain('LIMIT');
    expect(sql.text).not.toContain('SELECT *');
    expect(sql.text).not.toContain(params.id);
    expect(sql.values).toContain(params.id);
  });
  it('isolates release membership and does not concatenate source filters', () => {
    const attack = "source' OR TRUE --";
    const sql = detectionSelection(params.id, { source_id: attack });
    expect(sql.text).toContain('rp.release_id = c.release_id');
    expect(sql.text).toContain('EXISTS');
    expect(sql.text).toContain('standard');
    expect(sql.text).toContain("AT TIME ZONE 'UTC'");
    expect(sql.text).not.toContain(attack);
    expect(sql.values).toContain(attack);
  });
  it('invalidates the cache after completion or pinned release changes', () => {
    const context = { id: params.id, status: 'ready', time_basis: 'utc',
      metric_key: 'native_detections_v1', selection_policy: 'standard', grid_id: null, component_status: 'ready', release_status: 'published',
      release_id: params.id, cache_key: 'frozen', completed_at: new Date(1) };
    const key = tileCacheKey(params, context);
    expect(tileCacheKey(params, { ...context, completed_at: new Date(2) })).not.toBe(key);
    expect(tileCacheKey(params, { ...context, release_id: 'other' })).not.toBe(key);
    expect(tileCacheKey(params, context)).toBe(key);
  });
});
