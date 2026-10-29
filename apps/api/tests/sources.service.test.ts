import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn()
}));

vi.mock('@firebridge/database', () => ({
  prisma: {
    source: {
      findMany: mocks.findMany,
      create: mocks.create
    }
  }
}));

import { sourcesService } from '../src/services/sources.service.js';
import { decodeCursor, encodeCursor } from '../src/utils/sources-cursor.js';

// ---------------------------------------------------------------------------
// sourcesService.list
// ---------------------------------------------------------------------------

describe('sourcesService.list', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty page when no records match', async () => {
    mocks.findMany.mockResolvedValue([]);

    const result = await sourcesService.list({ limit: 50 });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { id: 'asc' },
      take: 51
    });
    expect(result).toEqual({ sources: [], nextCursor: null });
  });

  it('lists all sources with default limit when no filters are provided', async () => {
    const rows = [{ id: 'source-a' }, { id: 'source-b' }];
    mocks.findMany.mockResolvedValue(rows);

    const result = await sourcesService.list({ limit: 50 });

    // No kind / provider / cursor — where clause must be empty.
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { id: 'asc' },
      take: 51
    });
    expect(result).toEqual({ sources: rows, nextCursor: null });
  });

  it('applies a kind filter only when provider is absent', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'source-a' }]);

    await sourcesService.list({ kind: 'fire_mask', limit: 10 });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { kind: 'fire_mask' },
      orderBy: { id: 'asc' },
      take: 11
    });
  });

  it('applies a provider filter only when kind is absent', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'source-a' }]);

    await sourcesService.list({ provider: 'ESA', limit: 25 });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { provider: 'ESA' },
      orderBy: { id: 'asc' },
      take: 26
    });
  });

  it('applies both kind and provider filters simultaneously', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'source-a' }]);

    await sourcesService.list({ kind: 'hotspots', provider: 'NASA', limit: 10 });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { kind: 'hotspots', provider: 'NASA' },
      orderBy: { id: 'asc' },
      take: 11
    });
  });

  it('returns a bounded page and a signed cursor when more sources are available', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'source-a' }, { id: 'source-b' }, { id: 'source-c' }]);

    const signedCursor = encodeCursor({
      id: 'source-0',
      filters: { kind: 'hotspots', provider: 'NASA' }
    });

    const result = await sourcesService.list({
      kind: 'hotspots',
      provider: 'NASA',
      limit: 2,
      cursor: signedCursor
    });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        kind: 'hotspots',
        provider: 'NASA',
        id: { gt: 'source-0' }
      },
      orderBy: { id: 'asc' },
      take: 3
    });
    expect(result.sources).toEqual([{ id: 'source-a' }, { id: 'source-b' }]);
    expect(result.nextCursor).toBeDefined();

    const decodedNext = decodeCursor(result.nextCursor!);
    expect(decodedNext.id).toBe('source-b');
  });

  it('returns nextCursor: null on the last page (result count ≤ limit)', async () => {
    // Exactly limit records returned — no overflow item, so no next page.
    mocks.findMany.mockResolvedValue([{ id: 'source-a' }, { id: 'source-b' }]);

    const result = await sourcesService.list({ limit: 2 });

    expect(result.nextCursor).toBeNull();
    expect(result.sources).toHaveLength(2);
  });

  it('rejects an invalid, tampered or mismatched cursor with an error', async () => {
    await expect(
      sourcesService.list({
        kind: 'hotspots',
        limit: 10,
        cursor: 'invalid.cursor.token'
      })
    ).rejects.toThrow();
  });

  it('propagates database errors without swallowing them', async () => {
    mocks.findMany.mockRejectedValue(new Error('relation "sources" does not exist'));

    await expect(sourcesService.list({ limit: 50 })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// sourcesService.create
// ---------------------------------------------------------------------------

describe('sourcesService.create', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('generates a UUID for each new source', async () => {
    mocks.create.mockImplementation(({ data }) => Promise.resolve(data));

    const created = await sourcesService.create({
      name: 'VIIRS active fire',
      provider: 'NASA',
      kind: 'hotspots',
      product: 'VNP14IMG',
      collection: '2',
      processingStream: 'near-real-time',
      documentationUrl: 'https://example.org/source',
      citation: 'Example source citation',
      licenseInfo: 'Open data',
      schemaVersion: '1'
    });

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: created.id,
        name: 'VIIRS active fire'
      })
    });
  });

  it('propagates database errors on create without swallowing them', async () => {
    mocks.create.mockRejectedValue(new Error('duplicate key value violates unique constraint'));

    await expect(
      sourcesService.create({
        name: 'Duplicate',
        provider: 'Org',
        kind: 'hotspots',
        product: 'P1',
        collection: '1',
        processingStream: 'standard',
        documentationUrl: 'https://example.org',
        citation: 'cite',
        licenseInfo: 'MIT',
        schemaVersion: '1'
      })
    ).rejects.toThrow();
  });
});
