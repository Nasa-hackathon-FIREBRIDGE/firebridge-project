export const scopeProperty = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9_.:-]+$'
};
export const uuidProperty = { type: 'string', format: 'uuid' };
export function querySchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', additionalProperties: false, properties, required };
}
export const successSchema = {
  type: 'object',
  required: ['request_id', 'schema_version', 'data', 'warnings'],
  properties: {
    request_id: { type: 'string' },
    schema_version: { type: 'string' },
    data: { type: 'object', additionalProperties: true },
    warnings: { type: 'array', items: { type: 'string' } }
  }
};
