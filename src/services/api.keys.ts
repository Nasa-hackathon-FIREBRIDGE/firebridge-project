import type { DetectionTileRequest } from '@firebridge/contracts'
export const apiKeys = {
  all: ['firebridge'] as const,
  health: (probe: 'live' | 'ready') => ['firebridge', 'health', probe] as const,
  area: (id: string) => ['firebridge', 'area', id] as const,
  analysis: (id: string) => ['firebridge', 'analysis', id] as const,
  job: (id: string) => ['firebridge', 'job', id] as const,
  tiles: (id: string) => ['firebridge', 'tiles', id] as const,
  tile: (params: DetectionTileRequest) => [...apiKeys.tiles(params.id), params.layer, params.z, params.x, params.y] as const,
  catalog: (scopeKey?: string) =>
    ['firebridge', 'catalog', scopeKey ?? null] as const,
}
