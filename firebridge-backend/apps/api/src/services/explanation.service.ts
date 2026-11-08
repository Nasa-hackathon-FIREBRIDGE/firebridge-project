import { randomUUID } from 'node:crypto';
import {
  evidenceHash,
  isEvidenceBundle,
  renderEvidence,
  EXPLANATION_VERSION
} from '@firebridge/contracts';
import type { ContextService } from './context.service.js';
import type { SqlReader } from '../repositories/database.js';
import type { ExplanationInput } from '../validators/context.validator.js';
import { ApiError } from '../utils/response.js';

export class ExplanationService {
  constructor(private context: ContextService) {}
  private async detail(db: SqlReader, id: string, scope: string) {
    const rows = await db.query<{
      id: string;
      status: string;
      language: 'fr' | 'en';
      question: string;
      output_json: unknown;
      validation_report: Record<string, unknown> | null;
      created_at: string;
      completed_at: string | null;
      analysis_id: string;
      sha256: string;
      evidence_json: unknown;
      job_id: string;
    }>(
      `
      SELECT e.id::text,e.status,e.language,e.question,e.output_json,e.validation_report,
      e.created_at::text,e.completed_at::text,s.analysis_id::text,s.sha256,s.evidence_json,j.id::text AS job_id
      FROM firebridge.ai_explanations e JOIN firebridge.evidence_snapshots s ON s.id=e.snapshot_id
      JOIN firebridge.api_jobs j ON j.explanation_id=e.id AND j.kind='explanation' AND j.requested_by=$2
      WHERE e.id=$1::uuid ORDER BY j.created_at,j.id LIMIT 1`,
      [id, scope]
    );
    if (!rows.length) throw new ApiError(404, 'EXPLANATION_NOT_FOUND', 'Explanation not found.');
    const row = rows[0];
    let output: unknown = null;
    if (['validated', 'template_fallback'].includes(row.status)) {
      if (
        !isEvidenceBundle(row.evidence_json) ||
        evidenceHash(row.evidence_json) !== row.sha256 ||
        !['fr', 'en'].includes(row.language) ||
        evidenceHash(row.output_json) !==
          evidenceHash(renderEvidence(row.evidence_json, row.language, row.question))
      )
        throw new ApiError(
          409,
          'EXPLANATION_VALIDATION_FAILED',
          'Stored explanation does not match its evidence.'
        );
      output = row.output_json;
    }
    return {
      explanation_id: row.id,
      analysis_id: row.analysis_id,
      job_id: row.job_id,
      status: row.status,
      language: row.language,
      snapshot_sha256: row.sha256,
      created_at: row.created_at,
      completed_at: row.completed_at,
      generation_mode: 'deterministic_template',
      output,
      links: { analysis: `/api/v1/analyses/${row.analysis_id}`, job: `/api/v1/jobs/${row.job_id}` }
    };
  }
  get(id: string, scope: string) {
    return this.context.repository.read((db) => this.detail(db, id, scope));
  }
  async create(id: string, input: ExplanationInput, scope: string, key?: string) {
    if (key && !/^[\x21-\x7e]{1,256}$/.test(key))
      throw new ApiError(422, 'INVALID_IDEMPOTENCY_KEY', 'Invalid Idempotency-Key.');
    const requestHash = evidenceHash({
      analysis_id: id,
      ...input,
      template_version: EXPLANATION_VERSION
    });
    const database = this.context.repository.database;
    if (!database.transaction)
      throw new ApiError(503, 'WRITES_UNAVAILABLE', 'Explanation writes are unavailable.');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await database.transaction(async (db) => {
          await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          if (key) {
            const previous = await db.query<{ request_hash: string; explanation_id: string }>(
              `
              SELECT k.request_hash,j.explanation_id::text FROM firebridge.explanation_request_keys k
              JOIN firebridge.api_jobs j ON j.id=k.job_id WHERE k.requested_by=$1 AND k.idempotency_key=$2`,
              [scope, key]
            );
            if (previous.length) {
              if (previous[0].request_hash !== requestHash)
                throw new ApiError(
                  409,
                  'IDEMPOTENCY_CONFLICT',
                  'The key identifies another request.'
                );
              return {
                statusCode: 200 as const,
                data: await this.detail(db, previous[0].explanation_id, scope)
              };
            }
            const collision = await db.query(
              'SELECT id FROM firebridge.api_jobs WHERE requested_by=$1 AND idempotency_key=$2',
              [scope, key]
            );
            if (collision.length)
              throw new ApiError(
                409,
                'IDEMPOTENCY_CONFLICT',
                'The key identifies another operation.'
              );
          }
          const bundle = await this.context.evidence(db, id);
          if (!isEvidenceBundle(bundle))
            throw new ApiError(409, 'INVALID_EVIDENCE', 'The facts cannot be frozen safely.');
          const sha = evidenceHash(bundle),
            cache = evidenceHash({ sha, ...input, scope, version: EXPLANATION_VERSION });
          const old = await db.query<{ id: string; job_id: string }>(
            `SELECT e.id::text,j.id::text AS job_id
            FROM firebridge.ai_explanations e JOIN firebridge.api_jobs j ON j.explanation_id=e.id
            WHERE e.cache_key=$1 AND j.requested_by=$2 AND j.kind='explanation' ORDER BY j.created_at LIMIT 1`,
            [cache, scope]
          );
          if (old.length) {
            if (key)
              await db.query(
                `INSERT INTO firebridge.explanation_request_keys
              (requested_by,idempotency_key,request_hash,job_id) VALUES($1,$2,$3,$4::uuid)`,
                [scope, key, requestHash, old[0].job_id]
              );
            return { statusCode: 200 as const, data: await this.detail(db, old[0].id, scope) };
          }
          const snapshots = await db.query<{ id: string }>(
            `INSERT INTO firebridge.evidence_snapshots
            (id,analysis_id,schema_version,evidence_json,sha256) VALUES($1::uuid,$2::uuid,'1',$3::jsonb,$4)
            ON CONFLICT(analysis_id,sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id::text`,
            [randomUUID(), id, JSON.stringify(bundle), sha]
          );
          const explanationId = randomUUID(),
            jobId = randomUUID(),
            requestKey = key ?? 'explanation:' + cache;
          await db.query(
            `INSERT INTO firebridge.ai_explanations
            (id,snapshot_id,language,question,provider,model_id,prompt_version,tool_contract_version,status,cache_key)
            VALUES($1::uuid,$2::uuid,$3,$4,'deterministic',$5,'native-facts-v1','evidence-v1','queued',$6)`,
            [
              explanationId,
              snapshots[0].id,
              input.language,
              input.question,
              EXPLANATION_VERSION,
              cache
            ]
          );
          await db.query(
            `INSERT INTO firebridge.api_jobs
            (id,kind,analysis_id,explanation_id,requested_by,request_hash,idempotency_key,request_spec,status,progress)
            VALUES($1::uuid,'explanation',$2::uuid,$3::uuid,$4,$5,$6,$7::jsonb,'queued','{"stage":"awaiting_explanation_worker"}')`,
            [
              jobId,
              id,
              explanationId,
              scope,
              requestHash,
              requestKey,
              JSON.stringify({ analysis_id: id, ...input })
            ]
          );
          await db.query(
            `INSERT INTO firebridge.explanation_request_keys
            (requested_by,idempotency_key,request_hash,job_id) VALUES($1,$2,$3,$4::uuid)`,
            [scope, requestKey, requestHash, jobId]
          );
          await db.query(
            `INSERT INTO firebridge.outbox_events
            (id,event_type,aggregate_id,dedupe_key,payload,status,available_at)
            VALUES($1::uuid,'explanation.requested',$2,$3,$4::jsonb,'pending',now())`,
            [
              randomUUID(),
              explanationId,
              'explanation-' + explanationId,
              JSON.stringify({ job_id: jobId })
            ]
          );
          return { statusCode: 202 as const, data: await this.detail(db, explanationId, scope) };
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'SNAPSHOT_UNAVAILABLE' || attempt === 2)
          throw error;
      }
    }
    throw new ApiError(503, 'EXPLANATION_UNAVAILABLE', 'Explanation creation is unavailable.');
  }
}
