export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(statusCode: number, code: string, message: string, isOperational = true) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request.', code = 'BAD_REQUEST') {
    super(400, code, message);
    this.name = 'BadRequestError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation error.', code = 'VALIDATION_ERROR') {
    super(400, code, message);
    this.name = 'ValidationError';
  }
}

export class InvalidCursorError extends AppError {
  constructor(message = 'Invalid pagination cursor.', code = 'INVALID_CURSOR') {
    super(400, code, message);
    this.name = 'InvalidCursorError';
  }
}

export class MissingIdempotencyKeyError extends AppError {
  constructor(message = 'Idempotency-Key header is required for this operation.', code = 'MISSING_IDEMPOTENCY_KEY') {
    super(400, code, message);
    this.name = 'MissingIdempotencyKeyError';
  }
}

export class InvalidIdempotencyKeyError extends AppError {
  constructor(message = 'Invalid Idempotency-Key format.', code = 'INVALID_IDEMPOTENCY_KEY') {
    super(400, code, message);
    this.name = 'InvalidIdempotencyKeyError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.', code = 'NOT_FOUND') {
    super(404, code, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict.', code = 'CONFLICT') {
    super(409, code, message);
    this.name = 'ConflictError';
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = 'Idempotency key conflict.', code = 'IDEMPOTENCY_CONFLICT') {
    super(409, code, message);
    this.name = 'IdempotencyConflictError';
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests.', code = 'TOO_MANY_REQUESTS') {
    super(429, code, message);
    this.name = 'TooManyRequestsError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable.', code = 'SERVICE_UNAVAILABLE') {
    super(503, code, message);
    this.name = 'ServiceUnavailableError';
  }
}

