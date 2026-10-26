export type ApiResponse<T = null> = {
  status: 'ok' | 'planned' | 'error';
  message: string;
  data: T | null;
};

export type HealthStatus = {
  status: 'ok';
  service: string;
  uptimeMs: number;
  timestamp: string;
};
