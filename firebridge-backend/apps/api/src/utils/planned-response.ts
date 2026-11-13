import type { ApiResponse } from '../types/api.js';

export function plannedResponse<T = null>(message: string, data?: T): ApiResponse<T> {
  return {
    status: 'planned',
    message,
    data: data ?? null
  };
}
