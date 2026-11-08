// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Records } from './ApiPrimitives'

afterEach(cleanup)
it('sorts loaded numeric values while keeping unknown values distinct and last', () => {
  render(<Records rows={[{ id: 'unknown', frp_mw: null }, { id: 'measured', frp_mw: 12 }, { id: 'zero', frp_mw: 0 }]} />)
  fireEvent.click(screen.getByRole('button', { name: /frp mw/ }))
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
  expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(['zero', 'measured', 'unknown'])
  expect(rows[2].textContent).toContain('Inconnu / non disponible')
})
it('searches locally and prevents users from hiding the last visible column', () => {
  render(<Records rows={[{ platform: 'Aqua', count: '12' }, { platform: 'Terra', count: '7' }]} />)
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search this loaded table' }), { target: { value: 'Aqua' } })
  expect(screen.queryByText('Terra')).toBeNull()
  expect(screen.getByText('Aqua')).toBeTruthy()
  fireEvent.click(screen.getByText('Columns'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'count' }))
  expect((screen.getByRole('checkbox', { name: 'platform' }) as HTMLInputElement).disabled).toBe(true)
  expect(screen.queryByRole('columnheader', { name: /count/ })).toBeNull()
})
it('keeps full scientific provenance available when long values are collapsed', () => {
  const citation = 'SYNTHETIC TEST only; provenance is not validation. '.repeat(6)
  render(<Records rows={[{ citation }]} />)
  fireEvent.click(screen.getByText('Full value'))
  expect(screen.getByText(citation.trim(), { exact: false })).toBeTruthy()
  expect(document.querySelector('.platform-cell-details')?.hasAttribute('open')).toBe(true)
})
