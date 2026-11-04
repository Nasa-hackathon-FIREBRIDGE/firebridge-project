import type { AnalysisAccepted, AnalysisView, ApiEnvelope, CreateAnalysisRequest, CreateExportRequest, DetectionTileRequest, ExportAccepted } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'
export function createIdempotencyKey(): string { return crypto.randomUUID() }
export interface AnalysisMutation { input: CreateAnalysisRequest; idempotencyKey: string; signal?: AbortSignal }
export interface ExportMutation { analysisId: string; input: CreateExportRequest; idempotencyKey: string; signal?: AbortSignal }
export const analyses = {
  async create({ input, idempotencyKey, signal }: AnalysisMutation): Promise<AnalysisAccepted> {
    return unwrap((await api.post<ApiEnvelope<AnalysisAccepted>>('/analyses', input, { signal, headers: { 'Idempotency-Key': idempotencyKey } })).data)
  },
  async get(id: string, signal?: AbortSignal): Promise<AnalysisView> {
    return unwrap((await api.get<ApiEnvelope<AnalysisView>>(`/analyses/${encodeURIComponent(id)}`, { signal })).data)
  },
  async tile({ id, layer, z, x, y }: DetectionTileRequest, signal?: AbortSignal): Promise<ArrayBuffer> {
    return (await api.get<ArrayBuffer>(`/analyses/${encodeURIComponent(id)}/tiles/${layer}/${z}/${x}/${y}.mvt`, { signal, responseType: 'arraybuffer', headers: { Accept: 'application/vnd.mapbox-vector-tile' } })).data
  },
  async createExport({ analysisId, input, idempotencyKey, signal }: ExportMutation): Promise<ExportAccepted> {
    return unwrap((await api.post<ApiEnvelope<ExportAccepted>>(`/analyses/${encodeURIComponent(analysisId)}/exports`, input, { signal, headers: { 'Idempotency-Key': idempotencyKey } })).data)
  },
}
