import { describe, expect, it } from 'vitest';
import { nativePartitionSources, relevantNativePartitions } from '@firebridge/contracts';
import { coversInventory } from '../src/services/native-results.service.js';
import type { NativePartition } from '../src/repositories/native-results.repository.js';

const pipeline: NativePartition = {
  id: 'canonical-partition', series_key: 'detections:terra:global', partition_key: '2024-07-01',
  sha256: 'a'.repeat(64), row_count: '2', stored_rows: '2',
  serving_complete: true, validation_status: 'validated',
  support_spec: { source_id: 'terra', scope_key: 'global', bbox: [-180,-90,180,90],
    start: '2024-07-01T00:00:00+00:00', end_exclusive: '2024-07-02T00:00:00+00:00',
    query_complete: true, observation_coverage: 'unknown', processing_stream: 'standard' }
};
describe('Canonical Python publication metadata', () => {
  it('reads the canonical single-source partition without rewriting its metadata', () => {
    expect(nativePartitionSources(pipeline)).toEqual(['terra']);
    expect(pipeline.support_spec.source_ids).toBeUndefined();
  });
  it('retains explicit plural source selections, including an explicit empty selection', () => {
    expect(nativePartitionSources({ ...pipeline, support_spec: { source_id: 'terra', source_ids: ['aqua'] } })).toEqual(['aqua']);
    expect(nativePartitionSources({ ...pipeline, support_spec: { source_id: 'terra', source_ids: [] } })).toEqual([]);
  });
  it('does not widen a requested source to a different canonical partition', () => {
    expect(relevantNativePartitions([pipeline], ['aqua'], Date.parse('2024-07-01'), Date.parse('2024-07-02'))).toEqual([]);
  });
  it('understands canonical UTC offsets at the exclusive time boundary', () => {
    expect(relevantNativePartitions([pipeline], ['terra'], Date.parse('2024-07-02'), Date.parse('2024-07-03'))).toEqual([]);
    expect(relevantNativePartitions([pipeline], ['terra'], Date.parse('2024-07-01'), Date.parse('2024-07-02'))).toHaveLength(1);
  });
  it('never equates a complete provider query with verified area observation inventory', () => {
    expect(coversInventory([pipeline], 'terra', 'user-area', Date.parse('2024-07-01'), Date.parse('2024-07-02'), Date.parse('2024-07-03'))).toBe(false);
  });
});
