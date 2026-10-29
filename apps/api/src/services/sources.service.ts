import { randomUUID } from 'node:crypto';
import { prisma } from '@firebridge/database';
import type { z } from 'zod';
import type { sourceCreateSchema, sourceListQuerySchema } from '../validators/sources.validator.js';

export type SourceCreateInput = z.infer<typeof sourceCreateSchema>;
export type SourceListQuery = z.infer<typeof sourceListQuerySchema>;

export const sourcesService = {
  async list(query: SourceListQuery) {
    const records = await prisma.source.findMany({
      where: {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.provider ? { provider: query.provider } : {}),
        ...(query.cursor ? { id: { gt: query.cursor } } : {})
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1
    });

    const hasMore = records.length > query.limit;
    const sources = hasMore ? records.slice(0, query.limit) : records;
    return {
      sources,
      nextCursor: hasMore ? (sources[sources.length - 1]?.id ?? null) : null
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
