import { getResource, postResource, segment } from './resource'
import type { ExplanationAccepted, ExplanationInput } from './data.types'

export interface ExplanationMutation {
  analysisId: string
  input: ExplanationInput
  idempotencyKey: string
}

export const explanations = {
  create: ({ analysisId, input, idempotencyKey }: ExplanationMutation) =>
    postResource<ExplanationAccepted>(
      `/analyses/${segment(analysisId)}/explanations`,
      input,
      idempotencyKey,
    ),

  get: (id: string, signal?: AbortSignal) =>
    getResource<ExplanationAccepted>(
      `/explanations/${segment(id)}`,
      {},
      signal,
    ),
}
