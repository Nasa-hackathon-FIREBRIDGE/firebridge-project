// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Chapter, Figures, Scrolly } from './Story'

afterEach(cleanup)

describe('Night Edition building blocks', () => {
  it('keeps each figure’s label with its value', () => {
    render(<Figures label="Numbers" items={[{ label: 'Most unusual month', value: 'Jul 2022', note: 'two satellites agree' }]} />)
    expect(screen.getByText('Most unusual month').parentElement).toHaveTextContent('Jul 2022')
    expect(screen.getByText('two satellites agree')).toBeInTheDocument()
  })

  it('names a chapter by its finding', () => {
    render(<Chapter id="c" n={2} kicker="Where it burns" title="The season burns elsewhere"><p>body</p></Chapter>)
    expect(screen.getByRole('region', { name: 'The season burns elsewhere' })).toBeInTheDocument()
  })

  it('tells the story in steps and reports the step in view (the first one without a scroll observer)', () => {
    const onStep = vi.fn()
    const graphic = vi.fn((active: number) => <div>graphic at step {active}</div>)
    render(<Scrolly onStep={onStep} graphic={graphic} steps={[{ key: 'a', content: <p>First</p> }, { key: 'b', content: <p>Second</p> }]} />)
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByText('graphic at step 0')).toBeInTheDocument()
    expect(onStep).toHaveBeenCalledWith(0)
  })
})
