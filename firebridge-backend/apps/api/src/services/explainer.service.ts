import { AppError } from '../errors/app-error.js';

type FetchLike = typeof fetch;

/**
 * Client for the private FireBridge AI Agent. The API forwards a narrow set of browser
 * operations and adds the agent's service key, which never reaches the browser.
 */
export class ExplainerService {
  constructor(
    private readonly config: { url?: string; token?: string },
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  get configured(): boolean {
    return Boolean(this.config.url && this.config.token);
  }

  /** Readiness of the agent; never throws. */
  async status(): Promise<{ available: boolean; models_available: number }> {
    if (!this.configured) return { available: false, models_available: 0 };
    try {
      const response = await this.fetchImpl(this.url('/ready'), { signal: AbortSignal.timeout(3000) });
      const body = (await response.json()) as { status?: string; models_available?: number };
      return { available: response.ok && body.status === 'ready', models_available: Number(body.models_available ?? 0) };
    } catch {
      return { available: false, models_available: 0 };
    }
  }

  async call(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 180_000): Promise<unknown> {
    if (!this.configured) throw new AppError(503, 'EXPLAINER_UNAVAILABLE', 'The AI explainer is not configured.');
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method,
        headers: { 'x-api-key': this.config.token!, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw new AppError(503, 'EXPLAINER_UNAVAILABLE', 'The AI explainer is unreachable.');
    }
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (response.ok) return payload;
    // Authentication between the API and the agent is a server problem, not the browser's.
    if (response.status === 401 || response.status === 403 || response.status >= 500)
      throw new AppError(503, 'EXPLAINER_UNAVAILABLE', 'The AI explainer is unavailable.');
    const code = String(payload?.error?.code ?? 'explainer_error').toUpperCase();
    throw new AppError(response.status, `EXPLAINER_${code}`, payload?.error?.message ?? 'The AI explainer rejected the request.');
  }

  private url(path: string): string {
    return this.config.url!.replace(/\/+$/, '') + path;
  }
}
