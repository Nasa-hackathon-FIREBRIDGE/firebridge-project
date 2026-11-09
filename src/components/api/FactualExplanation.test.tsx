// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FactualExplanation } from './FactualExplanation'

afterEach(cleanup)

it('does not show unvalidated stored output for pending or rejected explanations', () => {
  const { rerender } = render(<FactualExplanation status="queued" output={{ summary: 'Unvalidated text' }} />)
  expect(screen.queryByText('Unvalidated text')).toBeNull()
  expect(screen.getByRole('status')).toBeTruthy()
  rerender(<FactualExplanation status="rejected" output={{ summary: 'Unvalidated text' }} />)
  expect(screen.queryByText('Unvalidated text')).toBeNull()
  expect(screen.getByRole('alert')).toBeTruthy()
})

it('renders cited factual output and deduplicates limitations without hiding the original response', () => {
  render(<FactualExplanation status="template_fallback" output={{
    summary: 'Résumé factuel',
    findings: [{ text: 'Comptage inconnu pour cette source.', source_id: 'opaque/source', value: null }],
    citations: [{ id: 'source:opaque', source_id: 'opaque/source', citation: 'NASA', product: 'VIIRS', collection: '2' }],
    limitations: ['DETECTIONS_ARE_NOT_UNIQUE_INCIDENTS', 'DETECTIONS_ARE_NOT_UNIQUE_INCIDENTS'],
  }} />)
  expect(screen.getByRole('heading', { name: 'Résumé factuel' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Sources citées' }).textContent).toContain('NASA')
  expect(screen.getByRole('region', { name: 'Limites de l’explication' }).querySelectorAll('li')).toHaveLength(1)
  expect(screen.getByText('Détails structurés de la réponse')).toBeTruthy()
})
