import { describe, expect, it } from 'vitest'
import { ESRI_ATTRIBUTION, ESRI_PROVIDER_ID, resolveBasemap } from './basemap'

describe('resolveBasemap', () => {
  it('makes no provider selection by default (schematic, no external requests)', () => {
    const selection = resolveBasemap('', '')
    expect(selection.kind).toBe('schematic')
    expect(selection.kind === 'schematic' && selection.reason).toMatch(/No background map has been configured/)
  })

  it('selects Esri World Imagery only when explicitly requested, with attribution', () => {
    const selection = resolveBasemap(undefined, ' Esri-World-Imagery ')
    expect(selection.kind).toBe('esri')
    if (selection.kind !== 'esri') return
    const source = Object.values(selection.style.sources)[0] as { attribution: string; type: string }
    expect(source.type).toBe('raster')
    expect(source.attribution).toBe(ESRI_ATTRIBUTION)
    expect(ESRI_PROVIDER_ID).toBe('esri-world-imagery')
  })

  it('gives VITE_MAP_STYLE_URL precedence over the provider', () => {
    const selection = resolveBasemap('https://styles.example.test/s.json', 'esri-world-imagery')
    expect(selection).toMatchObject({ kind: 'style-url', url: 'https://styles.example.test/s.json' })
  })

  it('does not silently substitute an unsupported provider', () => {
    const selection = resolveBasemap('', 'osm')
    expect(selection.kind).toBe('schematic')
    expect(selection.kind === 'schematic' && selection.reason).toMatch(/map provider is not supported/)
  })
})
