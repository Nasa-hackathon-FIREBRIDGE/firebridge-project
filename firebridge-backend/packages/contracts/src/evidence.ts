import { createHash } from 'node:crypto';

export const EXPLANATION_VERSION = 'native-facts-template-v1';
export interface EvidenceBundle {
  schema_version: '1';
  analysis_id: string;
  release_id: string;
  area_id: string;
  start_date: string;
  end_date_exclusive: string;
  time_basis: string;
  facts: {
    id: string;
    source_id: string;
    value: string | null;
    unit: 'detections';
    status: string;
  }[];
  citations: {
    id: string;
    source_id: string;
    citation: string;
    product: string;
    collection: string;
  }[];
  limitations: string[];
}
export function evidenceHash(value: unknown): string {
  function canonical(v: unknown): string {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object')
      return (
        '{' +
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, item]) => JSON.stringify(k) + ':' + canonical(item))
          .join(',') +
        '}'
      );
    return JSON.stringify(v);
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function isEvidenceBundle(value: unknown): value is EvidenceBundle {
  if (!value || typeof value !== 'object') return false;
  const b = value as EvidenceBundle;
  const uuid = (v: unknown) =>
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const day = (v: unknown) =>
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  return (
    b.schema_version === '1' &&
    uuid(b.analysis_id) &&
    uuid(b.release_id) &&
    uuid(b.area_id) &&
    day(b.start_date) &&
    day(b.end_date_exclusive) &&
    b.start_date < b.end_date_exclusive &&
    b.time_basis === 'utc' &&
    Array.isArray(b.citations) &&
    b.citations.every((c) => !!c && typeof c === 'object') &&
    Array.isArray(b.facts) &&
    b.facts.length <= 100 &&
    b.facts.every(
      (f) =>
        !!f &&
        typeof f === 'object' &&
        typeof f.id === 'string' &&
        f.id.length <= 256 &&
        typeof f.source_id === 'string' &&
        f.source_id.length <= 128 &&
        f.unit === 'detections' &&
        (f.value === null ||
          (typeof f.value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(f.value))) &&
        ['complete', 'lower_bound', 'unknown'].includes(f.status) &&
        (f.value !== null || f.status === 'unknown') &&
        (f.status !== 'unknown' || f.value === null) &&
        b.citations?.some((c) => c.source_id === f.source_id)
    ) &&
    Array.isArray(b.citations) &&
    b.citations.length <= 100 &&
    b.citations.every((c) =>
      [c.id, c.source_id, c.citation, c.product, c.collection].every(
        (s) => typeof s === 'string' && s.length <= 2000
      )
    ) &&
    Array.isArray(b.limitations) &&
    b.limitations.length <= 100 &&
    b.limitations.every((s) => typeof s === 'string' && s.length <= 200)
  );
}
export function renderEvidence(bundle: EvidenceBundle, language: 'fr' | 'en', question: string) {
  if (!isEvidenceBundle(bundle)) throw new Error('Invalid evidence snapshot.');
  const fr = language === 'fr';
  return {
    status: 'template_fallback',
    language,
    generation_mode: 'deterministic_template',
    analysis_id: bundle.analysis_id,
    data_release_id: bundle.release_id,
    summary: fr
      ? 'Résumé factuel des comptages natifs de l’analyse.'
      : 'Factual summary of the analysis native counts.',
    findings: bundle.facts.map((f) => ({
      fact_id: f.id,
      source_id: f.source_id,
      value: f.value,
      unit: f.unit,
      count_status: f.status,
      text:
        f.value === null
          ? fr
            ? 'Comptage inconnu pour cette source.'
            : 'Count unknown for this source.'
          : f.status === 'lower_bound'
            ? fr
              ? `Au moins ${f.value} détections dans les données consultables.`
              : `At least ${f.value} detections in the available records.`
            : fr
              ? `${f.value} détections dans l’inventaire vérifié complet.`
              : `${f.value} detections in the verified complete inventory.`,
      evidence_ids: [
        f.id,
        ...bundle.citations.filter((c) => c.source_id === f.source_id).map((c) => c.id)
      ]
    })),
    citations: bundle.citations.map(({ id, source_id, citation, product, collection }) => ({
      id,
      source_id,
      citation,
      product,
      collection
    })),
    limitations: [
      ...bundle.limitations,
      'DETECTIONS_ARE_NOT_UNIQUE_INCIDENTS',
      'NO_CAUSAL_OR_PREDICTIVE_INFERENCE',
      'EXTERNAL_LANGUAGE_MODEL_NOT_USED',
      ...(question ? ['FREEFORM_QUESTION_NOT_ANSWERED_BY_TEMPLATE'] : [])
    ],
    requested_question: question || null,
    selected_window: {
      start_date: bundle.start_date,
      end_date_exclusive: bundle.end_date_exclusive
    },
    template_version: EXPLANATION_VERSION
  };
}
