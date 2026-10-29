import { PrismaClient } from '@prisma/client';
export declare const prisma: PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/library").DefaultArgs>;
export declare function disconnectDatabase(): Promise<void>;
export declare const databaseStatus: {
    readonly provider: "postgresql";
    readonly geospatialSupport: "postgis-ready";
    readonly orm: "prisma";
};
