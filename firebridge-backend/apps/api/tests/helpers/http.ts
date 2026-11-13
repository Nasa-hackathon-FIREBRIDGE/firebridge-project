import Fastify, { type FastifyInstance, type HTTPMethods } from 'fastify';
import { afterEach } from 'vitest';
import { errorHandler } from '../../src/middleware/error-handler.js';

const applications = new Set<FastifyInstance>();
afterEach(async () => {
  await Promise.all([...applications].map((app) => app.close()));
  applications.clear();
});
export function testServer() {
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  applications.add(app);
  return app;
}
// Keep the original scenario assertions readable while running real Fastify injection.
export default function request(app: FastifyInstance) {
  applications.add(app);
  function build(method: HTTPMethods, url: string) {
    const headers: Record<string, string> = {};
    let payload: object | string | undefined;
    const execute = async () => {
      await app.ready();
      const response = await app.inject({ method, url, headers, payload });
      return {
        status: response.statusCode,
        headers: response.headers,
        text: response.payload,
        body: response.headers['content-type']?.includes('json') ? response.json() : {}
      };
    };
    return {
      set(name: string, value: string) {
        headers[name] = value;
        return this;
      },
      send(body: object | string) {
        payload = body;
        return this;
      },
      then: (...args: Parameters<ReturnType<typeof execute>['then']>) => execute().then(...args)
    };
  }
  return { get: (url: string) => build('GET', url), post: (url: string) => build('POST', url) };
}
