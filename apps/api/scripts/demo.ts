import { randomBytes } from 'node:crypto';
import { ids, seed, testDatabase } from '../tests/helpers/database.js';

// Development-only launcher. Reuse the isolated SQL fixtures used by the API tests.
// No connection to DATABASE_URL, Docker or external providers is made by this launcher.
if (process.env.NODE_ENV === 'production') {
  throw new Error('The demo server is only available in development.');
}
process.env.NODE_ENV = 'development';
process.env.PORT = process.env.DEMO_PORT ?? '3001';
process.env.DEFAULT_SCOPE_KEY = 'morocco';
process.env.CURSOR_SECRET = randomBytes(32).toString('hex');
process.env.DATABASE_URL = 'postgresql://demo:demo@127.0.0.1:1/demo';

// Import after setting the isolated configuration, before env.ts is evaluated.
const { createApp } = await import('../src/app.js');
const fixture = await testDatabase();
const app = createApp({
  database: fixture.adapter,
  documentation: {
    title: 'FIREBRIDGE — DEMO LOCALE — DONNEES FICTIVES',
    description:
      'Jeu de test isole en memoire. Aucun resultat NASA reel. ' +
      'scope_key: morocco ; alias: latest_standard ; ' +
      `release courante: ${ids.current} ; ancienne: ${ids.old} ; brouillon: ${ids.draft}. ` +
      'Voir docs/TEST_MANUEL_PHASE_1.md pour les cas a executer.'
  }
});
app.addHook('onRequest', async (_request, reply) => {
  reply.header('X-Firebridge-Demo', 'synthetic-data');
});
app.addHook('onClose', async () => fixture.adapter.close());
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exitCode = 0;
  });
}
try {
  await seed(fixture.db);
  await app.listen({ port: Number(process.env.PORT), host: '127.0.0.1' });
  app.log.info(
    `DEMO : donnees fictives uniquement. Swagger : http://localhost:${process.env.PORT}/api-docs/`
  );
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
