import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysesService } from '../src/services/analyses.service.js';
import { analysesRepository } from '../src/repositories/analyses.repository.js';
import { analysisCreateSchema } from '../src/validators/analyses.validator.js';
afterEach(() => vi.restoreAllMocks());
describe('Public analysis idempotency validation', () => {
  it.each(['', '   ', 'two keys', 'é', 'x'.repeat(257)])('rejects malformed explicit key before starting a database transaction', async (key) => {
    const create = vi.spyOn(analysesRepository, 'createAnalysisTransaction');
    const input = analysisCreateSchema.parse({ area_id: '33333333-3333-4333-8333-333333333333', start_date: '2024-01-01', end_date_exclusive: '2024-01-02' });
    await expect(analysesService.createAnalysis(input, key)).rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY', statusCode: 400 });
    expect(create).not.toHaveBeenCalled();
  });
});
