import type { DetectionTileRequest } from '@firebridge/contracts'
export const apiKeys = {
  all: ['firebridge'] as const,
  release: (id: string, params: object) => ['firebridge', 'release', id, params] as const,
  updates: (params: object) => ['firebridge', 'updates', params] as const,
  availability: (id: string, params: object) => ['firebridge', 'availability', id, params] as const,
  result: (id: string, name: string, params: object) => ['firebridge', 'results', id, name, params] as const,
  adminSession: (sessionId: string) => ['firebridge', 'admin', sessionId] as const,
  admin: (sessionId: string, name: string, params: object) => ['firebridge', 'admin', sessionId, name, params] as const,
  health: (probe: 'live' | 'ready') => ['firebridge', 'health', probe] as const,
  area: (id: string) => ['firebridge', 'area', id] as const,
  analysis: (id: string) => ['firebridge', 'analysis', id] as const,
  job: (id: string) => ['firebridge', 'job', id] as const,
  tiles: (id: string) => ['firebridge', 'tiles', id] as const,
  tile: (params: DetectionTileRequest) => [...apiKeys.tiles(params.id), params.layer, params.z, params.x, params.y] as const,
  catalog: (scopeKey?: string) => ['firebridge', 'catalog', scopeKey ?? null] as const,
  explanation: (id: string) => ['firebridge', 'explanation', id] as const,
}
