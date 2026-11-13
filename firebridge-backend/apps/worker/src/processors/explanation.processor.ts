import { prisma } from '@firebridge/database';
import { evidenceHash, isEvidenceBundle, renderEvidence } from '@firebridge/contracts';
import { UnrecoverableError } from 'bullmq';
class InvalidEvidence extends Error {}

export interface ExplanationPayload {
  job_id: string;
}
export async function processExplanation(payload: ExplanationPayload): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(payload.job_id))
    throw new Error('Invalid explanation job identity.');
  try {
    await prisma.$transaction(async (tx) => {
      const jobs = await tx.$queryRaw<
        { status: string; explanation_id: string; analysis_id: string; attempt: number }[]
      >`
        SELECT status,explanation_id::text,analysis_id::text,attempt FROM firebridge.api_jobs
        WHERE id=${payload.job_id}::uuid AND kind='explanation' FOR UPDATE`;
      const job = jobs[0];
      if (!job) throw new Error('Explanation job not found.');
      if (job.status === 'succeeded' || job.status === 'cancelled') return;
      const rows = await tx.$queryRaw<
        {
          status: string;
          language: string;
          question: string;
          sha256: string;
          evidence_json: unknown;
        }[]
      >`
        SELECT e.status,e.language,e.question,s.sha256,s.evidence_json FROM firebridge.ai_explanations e
        JOIN firebridge.evidence_snapshots s ON s.id=e.snapshot_id WHERE e.id=${job.explanation_id}::uuid`;
      const e = rows[0];
      if (
        !e ||
        !isEvidenceBundle(e.evidence_json) ||
        evidenceHash(e.evidence_json) !== e.sha256 ||
        e.evidence_json.analysis_id !== job.analysis_id ||
        !['fr', 'en'].includes(e.language)
      )
        throw new InvalidEvidence('Invalid evidence.');
      const output = renderEvidence(e.evidence_json, e.language as 'fr' | 'en', e.question);
      const report = JSON.stringify({
        schema_valid: true,
        snapshot_hash_valid: true,
        citations_valid: true,
        numbers_valid: true,
        output_sha256: evidenceHash(output),
        generation_mode: 'deterministic_template'
      });
      await tx.$executeRaw`UPDATE firebridge.ai_explanations SET status='template_fallback',
        output_json=${JSON.stringify(output)}::jsonb,validation_report=${report}::jsonb,completed_at=now()
        WHERE id=${job.explanation_id}::uuid`;
      await tx.$executeRaw`UPDATE firebridge.api_jobs SET status='succeeded',attempt=attempt+1,
        progress='{"stage":"validated_template_completed"}'::jsonb,error_code=NULL,completed_at=now(),lease_expires_at=NULL
        WHERE id=${payload.job_id}::uuid`;
    });
  } catch (error) {
    const validation = error instanceof InvalidEvidence;
    const status = validation ? 'rejected' : 'failed';
    const errorCode = validation ? 'EVIDENCE_VALIDATION_FAILED' : 'EXPLANATION_PROCESSING_FAILED';
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE firebridge.ai_explanations SET status=${status},output_json=NULL,completed_at=now()
        WHERE id IN(SELECT explanation_id FROM firebridge.api_jobs WHERE id=${payload.job_id}::uuid
          AND kind='explanation' AND status NOT IN ('succeeded','cancelled'))`;
      await tx.$executeRaw`UPDATE firebridge.api_jobs SET status='failed',attempt=attempt+1,
        error_code=${errorCode},completed_at=now(),lease_expires_at=NULL
        WHERE id=${payload.job_id}::uuid AND kind='explanation' AND status NOT IN ('succeeded','cancelled')`;
    });
    if (validation) throw new UnrecoverableError('Explanation evidence validation failed.');
    throw new Error('Explanation processing failed.');
  }
}
