import type {
  AnalysisAccepted,
  AnalysisView,
  ApiEnvelope,
  CreateAnalysisRequest,
  CreateExportRequest,
  DetectionTileRequest,
  ExportAccepted,
} from '@firebridge/contracts'
import api, { ApiClientError, unwrap } from '../lib/axios'
import { validateAccepted, validateAnalysis, validateExport } from '../lib/api.validation'
export const analysisDefaults = Object.freeze({
  metric_key: 'native_detections_v1',
  grid_id: null,
  data_mode: 'standard_only',
} as const)
export function createIdempotencyKey(): string {
  return crypto.randomUUID()
}
export interface AnalysisMutation {
  input: CreateAnalysisRequest
  idempotencyKey: string
  signal?: AbortSignal
}
export interface ExportMutation {
  analysisId: string
  input: CreateExportRequest
  idempotencyKey: string
  signal?: AbortSignal
}
export const analyses = {
  async create({ input, idempotencyKey, signal }: AnalysisMutation): Promise<AnalysisAccepted> {
    return validateAccepted(
      unwrap(
        (
          await api.post<ApiEnvelope<AnalysisAccepted>>(
            '/analyses',
            { ...analysisDefaults, ...input },
            { signal, headers: { 'Idempotency-Key': idempotencyKey } },
          )
        ).data,
      ),
    )
  },
  async get(id: string, signal?: AbortSignal): Promise<AnalysisView> {
    return validateAnalysis(
      unwrap(
        (
          await api.get<ApiEnvelope<AnalysisView>>(`/analyses/${encodeURIComponent(id)}`, {
            signal,
          })
        ).data,
      ),
    )
  },
  async tile(
    { id, layer, z, x, y }: DetectionTileRequest,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    if (
      layer !== 'detections' ||
      ![z, x, y].every(Number.isInteger) ||
      z < 0 ||
      z > 22 ||
      x < 0 ||
      y < 0 ||
      x >= 2 ** z ||
      y >= 2 ** z
    )
      throw new ApiClientError(
        'Unsupported layer or invalid tile coordinates.',
        'VALIDATION_ERROR',
        400,
      )
    return (
      await api.get<ArrayBuffer>(
        `/analyses/${encodeURIComponent(id)}/tiles/${layer}/${z}/${x}/${y}.mvt`,
        {
          signal,
          responseType: 'arraybuffer',
          headers: { Accept: 'application/vnd.mapbox-vector-tile' },
        },
      )
    ).data
  },
  async createExport({
    analysisId,
    input,
    idempotencyKey,
    signal,
  }: ExportMutation): Promise<ExportAccepted> {
    if (!['csv', 'geojson', 'parquet'].includes(input.format))
      throw new ApiClientError('Unsupported export format.', 'VALIDATION_ERROR', 400)
    return validateExport(
      unwrap(
        (
          await api.post<ApiEnvelope<ExportAccepted>>(
            `/analyses/${encodeURIComponent(analysisId)}/exports`,
            input,
            { signal, headers: { 'Idempotency-Key': idempotencyKey } },
          )
        ).data,
      ),
    )
  },
}
