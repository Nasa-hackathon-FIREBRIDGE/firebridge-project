import { describe, it, expect } from 'vitest';
import {
  evidenceHash,
  isEvidenceBundle,
  renderEvidence,
  type EvidenceBundle
} from '@firebridge/contracts';
const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bundle: EvidenceBundle = {
  schema_version: '1',
  analysis_id: uuid,
  release_id: uuid,
  area_id: uuid,
  start_date: '2024-01-17',
  end_date_exclusive: '2024-01-20',
  time_basis: 'utc',
  facts: [
    { id: 'a', source_id: 'terra', value: '0', unit: 'detections', status: 'complete' },
    { id: 'b', source_id: 'aqua', value: '3', unit: 'detections', status: 'lower_bound' },
    { id: 'c', source_id: 'viirs', value: null, unit: 'detections', status: 'unknown' }
  ],
  citations: ['terra', 'aqua', 'viirs'].map((source_id) => ({
    id: source_id,
    source_id,
    citation: 'Fixture',
    product: 'fixture',
    collection: '1'
  })),
  limitations: []
};
describe('Explanation evidence contract', () => {
  it('keeps zero, lower bounds and unknown counts distinct with citations', () => {
    const output = renderEvidence(bundle, 'en', 'why?');
    expect(output.findings[0].text).toContain('0 detections');
    expect(output.findings[1].text).toContain('At least 3');
    expect(output.findings[2].text).toContain('unknown');
    expect(output.limitations).toContain('FREEFORM_QUESTION_NOT_ANSWERED_BY_TEMPLATE');
    expect(output.findings.every((f) => f.evidence_ids.length === 2)).toBe(true);
  });
  it.each([
    null,
    { ...bundle, facts: [null] },
    { ...bundle, citations: [null] },
    { ...bundle, citations: [] },
    { ...bundle, facts: [{ ...bundle.facts[0], value: null }] },
    { ...bundle, facts: [{ ...bundle.facts[0], value: '9007199254740993', status: 'unknown' }] }
  ])('rejects malformed or contradictory evidence without throwing', (value) => {
    expect(isEvidenceBundle(value)).toBe(false);
  });
  it('hashes JSON independent of object property order and preserves bigint count strings', () => {
    expect(evidenceHash({ a: 1, b: 2 })).toBe(evidenceHash({ b: 2, a: 1 }));
    expect(
      renderEvidence(
        { ...bundle, facts: [{ ...bundle.facts[0], value: '9007199254740993' }] },
        'en',
        ''
      ).findings[0].value
    ).toBe('9007199254740993');
  });
});
