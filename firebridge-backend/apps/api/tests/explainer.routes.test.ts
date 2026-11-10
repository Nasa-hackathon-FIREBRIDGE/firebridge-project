import { describe, expect, it } from 'vitest';
import request from './helpers/http.js';
import { createApp } from '../src/app.js';
import { ExplainerService } from '../src/services/explainer.service.js';

const ANALYSIS = '13ad2e0c-cd43-4ee9-bcc6-fd8b273beb70';
const CLIENT = '0f8b3c2a-1d2e-4f5a-8b9c-0123456789ab';
const SESSION = 'a'.repeat(32);

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function agent(respond: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: Parameters<typeof fetch>[1]) => {
    const call = { url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, service: new ExplainerService({ url: 'http://agent.internal:8000/', token: 'service-key-0123456789' }, fetchImpl) };
}

describe('AI explainer proxy', () => {
  it('forwards a question with the service key and the viewing context', async () => {
    const { calls, service } = agent(() => ({ status: 200, body: { answer: 'July 2022 stands out [F25].', references: { months: ['2022-07'] } } }));
    const response = await request(createApp({ logger: false, explainer: service }))
      .post(`/api/v1/explainer/sessions/${SESSION}/messages`)
      .send({ content: 'Why this month?', context: { view: 'fire-calendar', month: '2022-07' } });
    expect(response.status).toBe(200);
    expect(response.body.data.references.months).toEqual(['2022-07']);
    expect(response.body.request_id).toBeTruthy();
    expect(calls[0]).toMatchObject({ url: `http://agent.internal:8000/v1/sessions/${SESSION}/messages`, method: 'POST', body: { content: 'Why this month?', context: { view: 'fire-calendar', month: '2022-07' } } });
    expect(calls[0].headers['x-api-key']).toBe('service-key-0123456789');
  });

  it('gives browsers an anonymous web identity and never accepts a user id', async () => {
    const { calls, service } = agent(() => ({ status: 201, body: { id: SESSION } }));
    const app = createApp({ logger: false, explainer: service });
    const created = await request(app).post('/api/v1/explainer/sessions').send({ analysis_id: ANALYSIS, client_id: CLIENT, language: 'fr' });
    expect(created.status).toBe(201);
    expect(calls[0].body).toEqual({ analysis_id: ANALYSIS, user_id: `web-${CLIENT}`, language: 'fr' });
    const spoofed = await request(app).post('/api/v1/explainer/sessions').send({ analysis_id: ANALYSIS, client_id: CLIENT, user_id: 'admin' });
    expect(spoofed.status).toBe(422);
    expect(calls).toHaveLength(1);
  });

  it('loads an analysis with the browser-computed report and asks for summaries', async () => {
    const { calls, service } = agent((call) => ({ status: call.url.endsWith('/summary') ? 200 : 201, body: { ok: true } }));
    const app = createApp({ logger: false, explainer: service });
    await request(app).post('/api/v1/explainer/analyses').send({ analysis_id: ANALYSIS, report: { report: { meta: {}, months: [] } } });
    await request(app).post(`/api/v1/explainer/analyses/${ANALYSIS}/summary`).send({ language: 'ar' });
    expect(calls.map((c) => [c.url.replace('http://agent.internal:8000', ''), c.body])).toEqual([
      ['/v1/analyses', { analysis_id: ANALYSIS, report: { report: { meta: {}, months: [] } }, use_api: true }],
      [`/v1/analyses/${ANALYSIS}/summary`, { language: 'ar', refresh: false }]
    ]);
  });

  it('validates identifiers before calling the agent', async () => {
    const { calls, service } = agent(() => ({ status: 200, body: {} }));
    const app = createApp({ logger: false, explainer: service });
    expect((await request(app).get('/api/v1/explainer/sessions/..%2Fmemories')).status).toBe(422);
    expect((await request(app).post(`/api/v1/explainer/sessions/${SESSION}/messages`).send({ content: '' })).status).toBe(422);
    expect((await request(app).post('/api/v1/explainer/analyses').send({ analysis_id: 'x' })).status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('maps agent failures without leaking server details', async () => {
    const notFound = agent(() => ({ status: 404, body: { error: { code: 'not_found', message: 'Session does not exist.' } } }));
    const missing = await request(createApp({ logger: false, explainer: notFound.service })).get(`/api/v1/explainer/sessions/${SESSION}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('EXPLAINER_NOT_FOUND');
    const badKey = agent(() => ({ status: 401, body: { error: { code: 'unauthorized' } } }));
    const unavailable = await request(createApp({ logger: false, explainer: badKey.service })).get(`/api/v1/explainer/sessions/${SESSION}`);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('EXPLAINER_UNAVAILABLE');
  });

  it('answers "not loaded yet" for an analysis the agent does not know', async () => {
    const { service } = agent(() => ({ status: 404, body: { error: { code: 'not_found', message: 'not ingested' } } }));
    const response = await request(createApp({ logger: false, explainer: service })).get(`/api/v1/explainer/analyses/${ANALYSIS}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ analysis_id: ANALYSIS, title: '', sources: [], facts: [] });
  });

  it('reports itself offline when the agent is not configured', async () => {
    const app = createApp({ logger: false, explainer: new ExplainerService({}) });
    expect((await request(app).get('/api/v1/explainer/status')).body.data).toEqual({ available: false, models_available: 0 });
    expect((await request(app).post(`/api/v1/explainer/sessions/${SESSION}/messages`).send({ content: 'hi' })).status).toBe(503);
  });
});
