import { describe, expect, it } from 'vitest';
import { analysisCreateSchema } from '../src/validators/analyses.validator.js';

const input = { area_id: '44444444-4444-4444-8444-444444444444', start_date: '2026-01-01', end_date_exclusive: '2026-03-01' };
describe('Analysis calendar date validation', () => {
  it.each(['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01'])('rejects invalid calendar date %s', (date) => {
    expect(analysisCreateSchema.safeParse({ ...input, start_date: date, end_date_exclusive: '2027-01-01' }).success).toBe(false);
    expect(analysisCreateSchema.safeParse({ ...input, end_date_exclusive: date }).success).toBe(false);
  });
  it('accepts a real leap day and preserves trimming', () => {
    expect(analysisCreateSchema.parse({ ...input, start_date: ' 2024-02-29 ' }).start_date).toBe('2024-02-29');
  });
  it('rejects equal and reversed bounds', () => {
    expect(analysisCreateSchema.safeParse({ ...input, end_date_exclusive: input.start_date }).success).toBe(false);
    expect(analysisCreateSchema.safeParse({ ...input, start_date: '2026-04-01' }).success).toBe(false);
  });
});
