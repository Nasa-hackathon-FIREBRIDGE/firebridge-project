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

export type CheckResult = 'ready' | 'unavailable' | 'not_checked';

export type ReadinessStatus = {
  status: 'ok' | 'error';
  service: string;
  checks: {
    database: CheckResult;
    redis: CheckResult;
    workers: CheckResult;
  };
  timestamp: string;
};
