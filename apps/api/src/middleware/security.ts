import type { FastifyReply, FastifyRequest } from 'fastify';

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
};

/**
 * Fastify-native routes: app.addHook('onRequest', securityHeaders) on the ROOT instance.
 */
export async function securityHeaders(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    reply.header(name, value);
  }
}