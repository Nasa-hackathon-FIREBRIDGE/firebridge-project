// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EvidencePage from './EvidencePage'
import SourcesPage from './SourcesPage'
import { ARCHIVE, ARCHIVE_TOTAL_ROWS, FIRE_PRODUCTS, usedRows } from './methods/facts'

beforeAll(() => {
  // Reveal animates on scroll; jsdom has no IntersectionObserver.
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  })
})
afterEach(cleanup)

const renderPage = (page: React.ReactNode) => render(<MemoryRouter>{page}</MemoryRouter>)

describe('archive facts', () => {
  it('add up to the audited total, with Landsat outside analyses', () => {
    expect(ARCHIVE.reduce((sum, platform) => sum + platform.rows, 0)).toBe(ARCHIVE_TOTAL_ROWS)
    expect(ARCHIVE.filter((platform) => !platform.used).map((platform) => platform.key)).toEqual(['landsat'])
    expect(usedRows).toBe(659_894_666)
  })
})

describe('Data & methods page', () => {
  it('walks through the pipeline with the archive per satellite', () => {
    renderPage(<EvidencePage />)
    expect(screen.getByRole('heading', { level: 1, name: /From a satellite pass to your fire calendar/ })).toBeInTheDocument()
    const bars = screen.getByRole('list', { name: 'Archived records per satellite' })
    expect(within(bars).getAllByRole('listitem')).toHaveLength(ARCHIVE.length)
    expect(within(bars).getByText('298.0 M')).toBeInTheDocument()
    expect(within(bars).getByText('not used')).toBeInTheDocument()
    expect(screen.getByText('659.9 M')).toBeInTheDocument()
    expect(screen.getByText('Nov 2000')).toBeInTheDocument()
  })

  it('labels each stage honestly and keeps technical detail one click away', () => {
    renderPage(<EvidencePage />)
    const steps = screen.getAllByRole('article')
    expect(steps).toHaveLength(7)
    expect(within(steps[0]).getByText('In production')).toBeInTheDocument()
    expect(within(steps[5]).getByText('Experimental · not independently validated')).toBeInTheDocument()
    expect(within(steps[6]).getByText('Live · language model')).toBeInTheDocument()
    expect(within(steps[5]).getByText(/has not been independently validated/)).toBeInTheDocument()
    const summary = within(steps[1]).getByText('How it works')
    fireEvent.click(summary)
    expect(summary.closest('details')).toHaveProperty('open', true)
    expect(screen.getByRole('heading', { name: 'No fire is not the same as not seen' })).toBeInTheDocument()
  })

  it('links to the catalogue and the credits', () => {
    renderPage(<EvidencePage />)
    expect(screen.getByRole('link', { name: /Live data catalogue/ })).toHaveAttribute('href', '/catalog')
    expect(screen.getByRole('link', { name: /Sources & credits/ })).toHaveAttribute('href', '/sources')
  })
})

describe('Sources & credits page', () => {
  it('cites every fire product by DOI', () => {
    renderPage(<SourcesPage />)
    const products = screen.getByRole('list', { name: 'Standard-quality fire products' })
    for (const product of FIRE_PRODUCTS) {
      expect(within(products).getByRole('link', { name: `doi:${product.doi}` })).toHaveAttribute('href', `https://doi.org/${product.doi}`)
    }
  })

  it('names imagery, boundaries, models and licences', () => {
    renderPage(<SourcesPage />)
    expect(within(screen.getByRole('list', { name: 'Basemaps' })).getByText(/NASA GIBS/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Boundary datasets' })).getAllByText('ODbL 1.0')).toHaveLength(2)
    expect(within(screen.getByRole('list', { name: 'Language models' })).getByText(/never writes answers/)).toBeInTheDocument()
    const web = screen.getByRole('list', { name: 'Web application' })
    expect(within(web).getByText('MapLibre GL JS').nextSibling).toHaveTextContent('BSD-3-Clause')
    expect(screen.getByText(/does not imply NASA endorsement/)).toBeInTheDocument()
  })

  it('discloses the AI tools used to build FIREBRIDGE and what they did not do', () => {
    renderPage(<SourcesPage />)
    expect(screen.getByRole('heading', { name: 'AI tools behind FIREBRIDGE' })).toBeInTheDocument()
    const tools = screen.getByRole('list', { name: 'AI development tools' })
    expect(within(tools).getByRole('link', { name: /Claude Code/ })).toBeInTheDocument()
    expect(within(tools).getByText(/Claude Sonnet 4.6 and Claude Opus 5.5/)).toBeInTheDocument()
    expect(within(tools).getByRole('link', { name: /OpenAI Codex/ })).toBeInTheDocument()
    expect(within(tools).getByText('Data pipeline')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'What AI did not do' })).getByText(/Every fire record comes from NASA FIRMS/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'What the team did' })).getAllByRole('listitem')).toHaveLength(3)
  })

  it('credits only open imagery, gives every model its licence and links our own code', () => {
    renderPage(<SourcesPage />)
    expect(screen.queryByText(/Esri/)).not.toBeInTheDocument()
    const models = screen.getByRole('list', { name: 'Language models' })
    expect(within(models).getAllByText('Apache-2.0')).toHaveLength(2)
    expect(within(models).getByText('Humain terms')).toBeInTheDocument()
    const code = screen.getByRole('list', { name: 'FIREBRIDGE repositories' })
    expect(within(code).getAllByText('MIT')).toHaveLength(3)
    expect(within(code).getByRole('link', { name: /web application and API/ })).toHaveAttribute('href', 'https://github.com/Nasa-hackathon-FIREBRIDGE/firebridge-project')
  })
})
