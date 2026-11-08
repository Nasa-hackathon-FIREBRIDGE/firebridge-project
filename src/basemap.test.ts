import { describe, expect, it } from 'vitest'
import { ESRI_ATTRIBUTION, ESRI_PROVIDER_ID, NASA_SOURCE_ID, resolveBasemap, selectBasemap } from './basemap'

describe('resolveBasemap', () => {
  it('defaults to real public NASA satellite imagery without requiring a key', () => {
    const selection = resolveBasemap('', '')
    expect(selection.kind).toBe('raster')
    if (selection.kind !== 'raster') return
    expect(selection.style.sources[NASA_SOURCE_ID]).toMatchObject({ type: 'raster', maxzoom: 8, tiles: [expect.stringContaining('BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg')] })
    expect(selection.description).toMatch(/archival composite/)
  })
  it('keeps offline mode explicit and provides attributed hybrid and street choices', () => {
    expect(resolveBasemap('', 'schematic')).toMatchObject({ kind: 'schematic', reason: expect.stringContaining('Offline coordinate grid selected') })
    const hybrid = selectBasemap('hybrid', resolveBasemap('', ''))
    if (hybrid.kind !== 'raster') throw Error('Expected a real hybrid style')
    expect(hybrid.style.layers).toHaveLength(4)
    expect(hybrid.style.sources['reference-labels']).toMatchObject({ attribution: expect.stringContaining('OpenStreetMap contributors') })
    expect(selectBasemap('streets', hybrid)).toMatchObject({ key: 'osm-streets', sourceId: 'firebridge-streets' })
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
  it('provides a genuine NASA alternative when a configured Esri provider fails', () => {
    const configured = resolveBasemap('', 'esri-world-imagery')
    expect(selectBasemap('configured', configured).kind).toBe('esri')
    expect(selectBasemap('satellite', configured)).toMatchObject({ kind: 'raster', sourceId: NASA_SOURCE_ID, key: 'nasa-satellite' })
  })

  it('does not silently substitute an unsupported provider', () => {
    const selection = resolveBasemap('', 'osm')
    expect(selection.kind).toBe('schematic')
    expect(selection.kind === 'schematic' && selection.reason).toMatch(/map provider is not supported/)
  })
})
