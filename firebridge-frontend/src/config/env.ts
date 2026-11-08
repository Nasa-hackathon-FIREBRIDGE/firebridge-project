/** Vite injects public configuration at build time. Never put server secrets here. */
export function parseApiUrl(value: unknown): string {
  const input = typeof value === 'string' && value.trim() ? value.trim() : 'http://localhost:3000/api/v1'
  let url: URL
  try { url = new URL(input) } catch { throw new Error('VITE_API_URL must be an absolute HTTP(S) URL ending in /api/v1.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, '') !== '/api/v1') {
    throw new Error('VITE_API_URL must be an absolute HTTP(S) URL ending in /api/v1, without credentials, query or fragment.')
  }
  return url.href.replace(/\/+$/, '')
}

export const env = Object.freeze({ api_url: parseApiUrl(import.meta.env.VITE_API_URL) })
