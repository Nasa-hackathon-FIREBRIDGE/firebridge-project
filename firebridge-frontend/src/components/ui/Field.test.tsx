// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input, Select } from './Field'

afterEach(cleanup)
describe('Input and Select', () => {
  it('labels input and connects hint, error and external descriptions', async () => {
    render(<><p id="units">UTC</p><Input label="Start" hint="YYYY-MM-DD" error="Required" aria-describedby="units" /></>)
    const input = screen.getByRole('textbox', { name: 'Start' })
    expect(input).toHaveAccessibleDescription('UTC YYYY-MM-DD Required')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(input, '2024-07-15')
    expect(input).toHaveValue('2024-07-15')
  })
  it('honors explicit IDs and disabled behavior', async () => {
    render(<Input id="area-name" label="Area name" disabled value="Saved area" readOnly />)
    expect(screen.getByLabelText('Area name')).toHaveAttribute('id', 'area-name')
    await userEvent.type(screen.getByLabelText('Area name'), 'change')
    expect(screen.getByLabelText('Area name')).toHaveValue('Saved area')
    expect(screen.getByLabelText('Area name')).toBeDisabled()
  })
  it('uses a native labelled select with keyboard focus and change events', async () => {
    const user = userEvent.setup()
    render(<Select label="Source" hint="Choose a stream"><option value="all">All</option><option value="aqua">Aqua</option></Select>)
    await user.tab()
    const select = screen.getByRole('combobox', { name: 'Source' })
    expect(select).toHaveFocus()
    expect(select).toHaveAccessibleDescription('Choose a stream')
    await user.selectOptions(select, 'aqua')
    expect(select).toHaveValue('aqua')
  })
  it('keeps select errors visible and respects disabled', () => {
    render(<Select label="Release" disabled error="Unavailable"><option>None</option></Select>)
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription('Unavailable')
    expect(screen.getByText('Unavailable')).toBeVisible()
  })
})
