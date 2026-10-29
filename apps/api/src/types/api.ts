export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_CURSOR: 'INVALID_CURSOR',
  MISSING_IDEMPOTENCY_KEY: 'MISSING_IDEMPOTENCY_KEY',
  INVALID_IDEMPOTENCY_KEY: 'INVALID_IDEMPOTENCY_KEY',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export type ApiSuccessResponse<T = null> = {
  status: 'ok' | 'planned';
  message: string;
  data: T | null;
};

export type ApiErrorResponse = {
  status: 'error';
  code: string;
  message: string;
  data: null;
};

export type ApiResponse<T = null> = ApiSuccessResponse<T> | ApiErrorResponse;

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
