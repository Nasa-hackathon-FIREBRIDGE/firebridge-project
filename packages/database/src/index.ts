import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
  dotenv.config({ path: rootEnvPath });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export const databaseStatus = {
  provider: 'postgresql',
  geospatialSupport: 'postgis-ready',
  orm: 'prisma'
} as const;
