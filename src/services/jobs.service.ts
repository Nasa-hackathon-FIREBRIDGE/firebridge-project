import type { ApiEnvelope, JobView } from '@firebridge/contracts'
import api, { ApiClientError, unwrap } from '../lib/axios'
import { validateJob } from '../lib/api.validation'
export interface ExportDownload {
  blob: Blob
  filename: string
}
export const jobs = {
  async get(id: string, signal?: AbortSignal): Promise<JobView> {
    return validateJob(
      unwrap(
        (await api.get<ApiEnvelope<JobView>>(`/jobs/${encodeURIComponent(id)}`, { signal })).data,
      ),
    )
  },
  async download(id: string, signal?: AbortSignal): Promise<ExportDownload> {
    const job = await jobs.get(id, signal)
    if (job.expires_at && Date.parse(job.expires_at) <= Date.now())
      throw new ApiClientError('Export expired.', 'EXPORT_GONE', 410)
    if (job.kind !== 'export' || job.status !== 'succeeded' || !job.download_url)
      throw new ApiClientError('Export is not successfully completed.', 'CONFLICT', 409)
    const url = new URL(job.download_url, api.defaults.baseURL)
    const expected = new URL(api.defaults.baseURL!)
    if (
      url.origin !== expected.origin ||
      url.pathname !== `/api/v1/jobs/${encodeURIComponent(id)}/download` ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new ApiClientError('Unexpected download URL.', 'INVALID_RESPONSE')
    const response = await api.get<Blob>(`/jobs/${encodeURIComponent(id)}/download${url.search}`, {
      signal,
      responseType: 'blob',
      timeout: 60_000,
      headers: { Accept: 'text/csv, application/geo+json, application/vnd.apache.parquet' },
    })
    const name = String(response.headers['content-disposition'] ?? '').match(
      /filename="([A-Za-z0-9._-]+)"/,
    )?.[1]
    return { blob: response.data, filename: name ?? `firebridge-${id}` }
  },
}
