import { useRef, useState } from 'react'
import { ChevronDown, FileText } from 'lucide-react'
import { SectionHeading } from '../../components/workspace/SectionHeading'
import { isRecord } from '../../lib/api.validation'
import { createIdempotencyKey } from '../../services/analyses.service'
import { ApiError, Empty, Status } from '../analyses/Feedback'
import { JobPanel } from '../analyses/JobPanel'
import { useContextRead, useCreateExplanation, useExplanation } from './useResults'
import { CopyableId } from '../../components/ui/CopyableId'

export function ContextPanel({ analysisId, initiallyExpanded = false }: { analysisId?: string; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const coverage = useContextRead(analysisId, 'coverage', expanded)
  const comparison = useContextRead(analysisId, 'comparison', expanded)
  const weather = useContextRead(analysisId, 'weather', expanded)
  const reports = useContextRead(analysisId, 'reports', expanded)
  const create = useCreateExplanation()
  const explanation = useExplanation(create.data?.explanation_id)
  const key = useRef<string | null>(null)
  const locked = useRef(false)
  const output = explanation.data?.output
  const findings =
    isRecord(output) && Array.isArray(output.findings) ? output.findings.filter(isRecord) : []
  async function generate() {
    if (!analysisId || locked.current) return
    locked.current = true
    key.current ??= createIdempotencyKey()
    try {
      await create.mutateAsync({ id: analysisId, key: key.current })
    } catch {
      /* Render the real mutation error. */
    } finally {
      locked.current = false
    }
  }
  return (
    <section className="fb-section" id="analysis-context" aria-labelledby="context-heading">
      <SectionHeading
        id="context-heading"
        eyebrow="04 / EVIDENCE & LIMITATIONS"
        title="Analysis context"
        description="Keep unavailable observations and scientific prerequisites explicit."
        action={
          <button
            className="button button-secondary"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            Review context
            <ChevronDown size={15} />
          </button>
        }
      />
      {expanded ? (
        !analysisId ? (
          <Empty>Select an analysis to review context and generate a factual note.</Empty>
        ) : (
          <>
            <div className="fb-context-grid">
              {[
                {
                  title: 'Observation coverage',
                  query: coverage,
                  detail:
                    coverage.data?.observation_coverage_status === 'unknown'
                      ? 'Unknown · observation masks and a grid are required.'
                      : 'Coverage is reported only when prepared evidence is available.',
                },
                {
                  title: 'Source comparison',
                  query: comparison,
                  detail:
                    'Native counts are separate sensor inventories, not a harmonized response.',
                },
                {
                  title: 'Weather context',
                  query: weather,
                  detail: 'No values are filled in when the pinned weather component is missing.',
                },
                {
                  title: 'Reports & events',
                  query: reports,
                  detail: 'Reports are context, not a verified inventory of fire incidents.',
                },
              ].map(({ title, query, detail }) => (
                <article key={title}>
                  <div>
                    <h3>{title}</h3>
                    <Status
                      value={query.isError ? 'unavailable' : (query.data?.status ?? 'loading')}
                    />
                  </div>
                  <p>{detail}</p>
                  <ApiError
                    error={query.error}
                    retry={() => {
                      void query.refetch()
                    }}
                  />
                  {query.data?.reasons?.length ? (
                    <small>
                      {query.data.reasons
                        .map((reason) => reason.replaceAll('_', ' ').toLowerCase())
                        .join(' · ')}
                    </small>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="fb-factual-note">
              <div>
                <span className="fb-eyebrow">REPRODUCIBLE NOTE</span>
                <h3>Summarize the pinned evidence</h3>
                <p>
                  A deterministic summary of native counts and their limitations. No external AI
                  model or causal inference.
                </p>
              </div>
              <button
                type="button"
                className="button button-primary"
                disabled={create.isPending || !!create.data}
                onClick={() => {
                  void generate()
                }}
              >
                <FileText size={15} />
                {create.isPending ? 'Requesting note…' : 'Generate factual note'}
              </button>
            </div>
            <ApiError error={create.error} />
            <ApiError
              error={explanation.error}
              retry={() => {
                void explanation.refetch()
              }}
            />
            {explanation.data && (
              <div className="fb-note-output">
                <Status value={explanation.data.status} />
                <CopyableId value={explanation.data.explanation_id} label="explanation ID" />
                {isRecord(output) && typeof output.summary === 'string' && (
                  <h3>{output.summary}</h3>
                )}
                {findings.length > 0 && (
                  <ul>
                    {findings.map((finding, index) => (
                      <li key={typeof finding.fact_id === 'string' ? finding.fact_id : index}>
                        {typeof finding.text === 'string'
                          ? finding.text
                          : 'No textual finding supplied.'}
                        <small>
                          {typeof finding.source_id === 'string' ? finding.source_id : ''}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
                {explanation.data.job_id && (
                  <JobPanel key={explanation.data.job_id} id={explanation.data.job_id} />
                )}
              </div>
            )}
          </>
        )
      ) : (
        <p className="fb-context-intro">
          Coverage, source comparability, weather, reports and a reproducible factual note are
          available for review. Missing inputs stay missing.
        </p>
      )}
    </section>
  )
}
