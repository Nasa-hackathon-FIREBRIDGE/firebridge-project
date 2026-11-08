// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateRangePicker } from './DateRangePicker'

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Harness({ changed, submit, disabled = false }: { changed: (field: string, value: string) => void; submit: (data: FormData) => void; disabled?: boolean }) {
  const [dates, setDates] = useState({ start: '', end: '' })
  const start = (value: string) => { changed('start', value); setDates(current => ({ ...current, start: value })) }
  const end = (value: string) => { changed('end', value); setDates(current => ({ ...current, end: value })) }
  return <form onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)) }}><fieldset disabled={disabled}>
    <DateRangePicker start={dates.start} end={dates.end} onStartChange={start} onEndChange={end} disabled={disabled} triggerLabel="Open test date picker">
      <label>Native start<input name="start" type="date" value={dates.start} onChange={event => start(event.target.value)} /></label>
      <label>Native end<input name="end" type="date" value={dates.end} onChange={event => end(event.target.value)} /></label>
    </DateRangePicker><button type="submit">Submit interval</button>
  </fieldset></form>
}

it('keeps native date fields visible when closed and mirrors callbacks/FormData exactly', async () => {
  const user = userEvent.setup(), changed = vi.fn(), submit = vi.fn()
  render(<Harness changed={changed} submit={submit} />)
  expect(screen.getByLabelText('Native start')).toBeVisible()
  expect(screen.getByLabelText('Native end')).toBeVisible()
  expect(screen.getByText(/YYYY-MM-DD.*end excluded · UTC/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Open test date picker' }))
  const dialog = screen.getByRole('dialog', { name: 'Open test date picker' })
  // Use standard change events for jsdom's native date inputs; Chrome editing is tested separately.
  fireEvent.change(within(dialog).getByLabelText('Start date in date picker'), { target: { value: '2024-07-15' } })
  fireEvent.change(within(dialog).getByLabelText('Exclusive end date in date picker'), { target: { value: '2024-07-18' } })
  expect(screen.getByLabelText('Native start')).toHaveValue('2024-07-15')
  expect(screen.getByLabelText('Native end')).toHaveValue('2024-07-18')
  await user.click(within(dialog).getByRole('button', { name: 'Close date picker' }))
  expect(screen.getByLabelText('Native start')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit interval' }))
  expect(Object.fromEntries(submit.mock.calls[0][0].entries())).toEqual({ start: '2024-07-15', end: '2024-07-18' })
  expect(changed.mock.calls).toEqual([['start', '2024-07-15'], ['end', '2024-07-18']])
})
it('opens by keyboard, dismisses with Escape and restores trigger focus', async () => {
  const user = userEvent.setup()
  render(<Harness changed={() => {}} submit={() => {}} />)
  const trigger = screen.getByRole('button', { name: 'Open test date picker' })
  trigger.focus(); await user.keyboard('{Enter}')
  expect(screen.getByRole('dialog')).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
})
it('retains the existing disabled state without a hidden-only edit path', async () => {
  render(<Harness changed={() => {}} submit={() => {}} disabled />)
  expect(screen.getByLabelText('Native start')).toBeDisabled()
  expect(screen.getByLabelText('Native end')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Open test date picker' })).toBeDisabled()
})
