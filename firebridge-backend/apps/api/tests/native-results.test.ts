import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { coversInventory } from '../src/services/native-results.service.js';
import type { NativePartition } from '../src/repositories/native-results.repository.js';
import type { SnapshotDatabase } from '../src/repositories/database.js';

const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const first = Date.parse('2024-01-01T00:00:00Z'),
  middle = Date.parse('2024-01-02T00:00:00Z'),
  end = Date.parse('2024-01-03T00:00:00Z');
function part(start: number, stop: number, extra: Partial<NativePartition> = {}): NativePartition {
  return {
    id: 'partition',
    series_key: 'terra',
    partition_key: 'day',
    sha256: 'a'.repeat(64),
    row_count: '0',
    stored_rows: '0',
    serving_complete: true,
    validation_status: 'validated',
    support_spec: {
      area_id: 'area',
      inventory_complete: true,
      source_ids: ['terra'],
      start: new Date(start).toISOString(),
      end_exclusive: new Date(stop).toISOString()
    },
    ...extra
  };
}
describe('Native inventory completeness', () => {
  it('accepts adjacent verified intervals and tolerates overlapping membership', () => {
    expect(
      coversInventory(
        [part(first, middle), part(middle, end), part(first, middle)],
        'terra',
        'area',
        first,
        end,
        end
      )
    ).toBe(true);
  });
  it('does not fill gaps in the declared inventory', () => {
    expect(
      coversInventory(
        [part(first, middle), part(middle + 1, end)],
        'terra',
        'area',
        first,
        end,
        end
      )
    ).toBe(false);
  });
  it('requires source, area, publication cutoff and an explicit completeness verification', () => {
    const whole = part(first, end);
    expect(coversInventory([whole], 'aqua', 'area', first, end, end)).toBe(false);
    expect(coversInventory([whole], 'terra', 'other', first, end, end)).toBe(false);
    expect(coversInventory([whole], 'terra', 'area', first, end, middle)).toBe(false);
    expect(coversInventory([whole], 'terra', 'area', first, end, end, middle)).toBe(false);
    delete whole.support_spec.inventory_complete;
    expect(coversInventory([whole], 'terra', 'area', first, end, end)).toBe(false);
  });
  it('does not trust incomplete, unvalidated or inconsistent serving rows', () => {
    for (const extra of [
      { serving_complete: false },
      { validation_status: 'pending' },
      { row_count: '1' }
    ])
      expect(coversInventory([part(first, end, extra)], 'terra', 'area', first, end, end)).toBe(
        false
      );
  });
});
describe('Native result route contracts', () => {
  function build() {
    const query = vi.fn(async () => []);
    const database: SnapshotDatabase = {
      snapshot: (read) => read({ query }),
      close: async () => {}
    };
    const app = createApp({ database, logger: false });
    apps.push(app);
    return { app, query };
  }
  it('documents the four actual analysis child routes in Swagger', async () => {
    const { app } = build();
    const spec = (await app.inject('/api-docs/json')).json();
    for (const name of ['detections', 'summary', 'calendar', 'provenance'])
      expect(spec.paths[`/api/v1/analyses/{id}/${name}`].get.tags).toContain('Phase 3');
  });
  it('rejects malformed IDs and unsupported parameters before a database read', async () => {
    const { app, query } = build();
    for (const path of [
      'not-a-uuid/detections',
      'a3000000-0000-4000-8000-000000000001/detections?limit=0',
      'a3000000-0000-4000-8000-000000000001/summary?metric_key=other',
      'a3000000-0000-4000-8000-000000000001/calendar?resolution=year',
      'a3000000-0000-4000-8000-000000000001/provenance?asset_id=bad'
    ])
      expect((await app.inject('/api/v1/analyses/' + path)).statusCode).toBe(422);
    expect(query).not.toHaveBeenCalled();
  });
  it('returns a safe 404 envelope when the saved analysis is absent', async () => {
    const { app } = build();
    const res = await app.inject('/api/v1/analyses/a3000000-0000-4000-8000-000000000001/summary');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ data: null, error: { code: 'ANALYSIS_NOT_FOUND' } });
    expect(res.headers['x-request-id']).toBe(res.json().request_id);
  });
});
