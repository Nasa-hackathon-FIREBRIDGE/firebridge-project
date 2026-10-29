import type { FastifyRequest } from 'fastify';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}
export function envelope<T>(request: FastifyRequest, data: T, warnings: string[] = []) {
  return { request_id: request.id, schema_version: '1', data, warnings };
}
