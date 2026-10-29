import { randomUUID } from 'node:crypto';
import { prisma } from '@firebridge/database';
import type { z } from 'zod';
import type { sourceCreateSchema, sourceListQuerySchema } from '../validators/sources.validator.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';

export type SourceCreateInput = z.infer<typeof sourceCreateSchema>;
export type SourceListQuery = z.infer<typeof sourceListQuerySchema>;

export const sourcesService = {
  async list(query: SourceListQuery) {
    let cursorId: string | undefined;

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor, {
        kind: query.kind,
        provider: query.provider
      });
      cursorId = decoded.id;
    }

    const records = await prisma.source.findMany({
      where: {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.provider ? { provider: query.provider } : {}),
        ...(cursorId ? { id: { gt: cursorId } } : {})
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1
    });

    const hasMore = records.length > query.limit;
    const sources = hasMore ? records.slice(0, query.limit) : records;
    const lastSource = hasMore ? sources[sources.length - 1] : null;

    const nextCursor =
      hasMore && lastSource
        ? encodeCursor({
            id: lastSource.id,
            filters: {
              ...(query.kind ? { kind: query.kind } : {}),
              ...(query.provider ? { provider: query.provider } : {})
            }
          })
        : null;

    return {
      sources,
      nextCursor
    };
  },

  async create(source: SourceCreateInput) {
    return prisma.source.create({
      data: {
        id: randomUUID(),
        ...source
      }
    });
  }
};
