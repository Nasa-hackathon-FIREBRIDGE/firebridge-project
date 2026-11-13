#!/usr/bin/env node
/**
 * Prepares the places the zone picker offers, into public/places/:
 *   countries.json          every country (Natural Earth 10 m, Morocco worldview, public domain)
 *   <ISO3>/regions.json     first-level units (geoBoundaries gbOpen ADM1, ODbL 1.0)
 *   <ISO3>/provinces.json   second-level units (geoBoundaries gbOpen ADM2, ODbL 1.0)
 *   <ISO3>/forests.json     named forests, woods, parks and reserves (© OpenStreetMap contributors, ODbL 1.0)
 *   index.json              which countries are prepared
 *
 *   node scripts/places/prepare.mjs countries
 *   node scripts/places/prepare.mjs MAR [ESP …]
 *
 * Countries that are not prepared still get regions and provinces in the browser, straight from the
 * same pinned geoBoundaries release; only forests need this script.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mapshaper from 'mapshaper'
import polygonClipping from 'polygon-clipping'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/places')
const NATURAL_EARTH =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/9380cca83db5f9aef52d5e762765100745f84b27/geojson/ne_10m_admin_0_countries_mar.geojson'
const GB_COMMIT = '9469f09592ced973a3448cf66b6100b741b64c0d'
const gbUrl = (iso3, adm) =>
  `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${GB_COMMIT}/releaseData/gbOpen/${iso3}/${adm}/geoBoundaries-${iso3}-${adm}_simplified.geojson`
const GB_LIST = (adm) => `https://www.geoboundaries.org/api/current/gbOpen/ALL/${adm}/`
const OVERPASS = 'https://overpass-api.de/api/interpreter'
const ZONE_TAB = '/usr/share/zoneinfo/zone.tab'
// Overpass answers are kept between runs, so re-preparing a country does not query the public servers again.
const CACHE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/.cache/firebridge-places')

// The server accepts 5,000 vertices per area; a margin keeps rounding from tipping a unit over.
const MAX_VERTICES = 4900
const MIN_FOREST_KM2 = 1
const MAX_FORESTS = 400
const TILE_DEGREES = 8

const R = 6371008.8
const rad = (d) => (d * Math.PI) / 180
const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])
const vertices = (g) => polygonsOf(g).reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0)
function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) a += rad(ring[i + 1][0] - ring[i][0]) * (2 + Math.sin(rad(ring[i][1])) + Math.sin(rad(ring[i + 1][1])))
  return Math.abs((a * R * R) / 2)
}
const areaKm2 = (g) => polygonsOf(g).reduce((s, [outer, ...holes]) => s + ringArea(outer) - holes.reduce((h, r) => h + ringArea(r), 0), 0) / 1e6
const collection = (features) => ({ type: 'FeatureCollection', features })

async function fetchJson(url, init, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { ...init, headers: { 'user-agent': 'firebridge-places-preparation', ...init?.headers } })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt))
    }
  }
}

async function shape(features, commands, precision = 0.0001) {
  const out = await mapshaper.applyCommands(`-i in.json ${commands} -o out.json format=geojson precision=${precision}`, { 'in.json': JSON.stringify(collection(features)) })
  return JSON.parse(out['out.json'].toString()).features
}

/** Geometry only goes through mapshaper; attributes are re-attached by id so nested values survive. */
async function reshape(features, commands, precision) {
  const props = new Map(features.map((f) => [f.properties.id, f.properties]))
  const shaped = await shape(features.map((f) => ({ type: 'Feature', properties: { id: f.properties.id }, geometry: f.geometry })), commands, precision)
  return shaped.filter((f) => f.geometry).map((f) => ({ type: 'Feature', properties: props.get(f.properties.id), geometry: f.geometry }))
}

/** Simplifies, one feature at a time, only the units over the vertex limit. */
async function capVertices(features) {
  const out = []
  for (const feature of features) {
    let current = feature
    for (let keep = (MAX_VERTICES / vertices(feature.geometry)) * 90; vertices(current.geometry) > MAX_VERTICES; keep *= 0.7) {
      const [simplified] = await reshape([feature], `-simplify ${Math.max(0.1, keep).toFixed(2)}% keep-shapes -clean`)
      if (simplified) current = simplified
    }
    out.push(current)
  }
  return out
}

/** Some source boundaries have tiny spikes that cross themselves, which PostGIS rejects; a union rebuilds them cleanly. */
function repaired(geometry) {
  const parts = polygonClipping.union(...polygonsOf(geometry).map((p) => [p]))
  return parts.length === 1 ? { type: 'Polygon', coordinates: parts[0] } : { type: 'MultiPolygon', coordinates: parts }
}

/** Every unit ends within the vertex limit and valid for the server. */
async function finish(features) {
  return (await capVertices(features)).map((f) => ({ ...f, geometry: repaired(f.geometry) })).filter((f) => polygonsOf(f.geometry).length)
}

async function timezones() {
  const zones = {}
  for (const line of (await readFile(ZONE_TAB, 'utf8')).split('\n')) {
    if (!line || line.startsWith('#')) continue
    const [code, coords, zone] = line.split('\t')
    const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(coords)
    if (!m) continue
    const lat = (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60)
    const lon = (m[5] === '-' ? -1 : 1) * (Number(m[6]) + Number(m[7]) / 60)
    ;(zones[code] ??= []).push([zone, Math.round(lat * 100) / 100, Math.round(lon * 100) / 100])
  }
  return zones
}

async function countries() {
  const [ne, zones, adm1, adm2] = await Promise.all([fetchJson(NATURAL_EARTH), timezones(), fetchJson(GB_LIST('ADM1')), fetchJson(GB_LIST('ADM2'))])
  const units = (list) => Object.fromEntries(list.map((b) => [b.boundaryISO, Number(b.admUnitCount) || 0]))
  const regions = units(adm1)
  const provinces = units(adm2)
  const code = (v) => (v && v !== '-99' ? v : null)
  const features = ne.features.map((f) => {
    const p = f.properties
    const iso3 = code(p.ISO_A3) ?? code(p.ISO_A3_EH)
    const iso2 = code(p.ISO_A2) ?? code(p.ISO_A2_EH)
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: p.ADM0_A3,
        iso3,
        name: p.NAME_EN,
        name_fr: p.NAME_FR,
        name_ar: p.NAME_AR,
        area_km2: Math.round(areaKm2(f.geometry)),
        regions: (iso3 && regions[iso3]) || 0,
        provinces: (iso3 && provinces[iso3]) || 0,
        zones: (iso2 && zones[iso2]) || [],
      },
    }
  })
  // Display outlines only: a selected country is saved from its geoBoundaries boundary.
  const shaped = await reshape(features, '-simplify interval=3000 keep-shapes -clean', 0.001)
  await mkdir(OUT, { recursive: true })
  await writeFile(path.join(OUT, 'countries.json'), JSON.stringify(collection(shaped)))
  console.log(`countries.json: ${shaped.length} countries, ${shaped.reduce((n, f) => n + vertices(f.geometry), 0)} vertices`)
}

async function units(iso3, level) {
  const adm = level === 'region' ? 'ADM1' : level === 'province' ? 'ADM2' : 'ADM0'
  const gb = await fetchJson(gbUrl(iso3, adm))
  if (!gb) return null
  const features = gb.features
    .filter((f) => f.geometry)
    .map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: `gb-${f.properties.shapeID}`,
        name: f.properties.shapeName,
        level,
        iso3,
        area_km2: Math.round(areaKm2(f.geometry)),
        source: `geoBoundaries gbOpen ${iso3} ${adm} (ODbL 1.0)`,
        source_id: f.properties.shapeID,
      },
    }))
  return finish(await reshape(features, '-clean'))
}

// ── OpenStreetMap forests ───────────────────────────────────────────────────

function forestQuery([w, s, e, n]) {
  const box = `(${s},${w},${n},${e})`
  const tags = ['["landuse"="forest"]["name"]', '["natural"="wood"]["name"]', '["boundary"~"^(protected_area|national_park)$"]["name"]', '["leisure"="nature_reserve"]["name"]']
  return `[out:json][timeout:600];(${tags.map((t) => `way${t}${box};relation${t}${box};`).join('')});out geom;`
}

function tiles([w, s, e, n]) {
  const out = []
  for (let x = w; x < e; x += TILE_DEGREES) for (let y = s; y < n; y += TILE_DEGREES) out.push([x, y, Math.min(e, x + TILE_DEGREES), Math.min(n, y + TILE_DEGREES)])
  return out
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1]

/** Joins way segments end to end into closed rings; segments that never close are dropped. */
function assembleRings(segments) {
  const open = segments.map((s) => s.slice())
  const rings = []
  while (open.length) {
    let ring = open.shift()
    for (let joined = true; joined && !same(ring[0], ring.at(-1)); ) {
      joined = false
      for (let i = 0; i < open.length; i++) {
        const s = open[i]
        if (same(ring.at(-1), s[0])) ring = ring.concat(s.slice(1))
        else if (same(ring.at(-1), s.at(-1))) ring = ring.concat(s.slice(0, -1).reverse())
        else if (same(ring[0], s.at(-1))) ring = s.slice(0, -1).concat(ring)
        else if (same(ring[0], s[0])) ring = s.slice(1).reverse().concat(ring)
        else continue
        open.splice(i, 1)
        joined = true
        break
      }
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) rings.push(ring)
  }
  return rings
}

function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function elementGeometry(element) {
  const line = (geometry) => (geometry ?? []).map((p) => [p.lon, p.lat])
  if (element.type === 'way') {
    const ring = line(element.geometry)
    return ring.length >= 4 && same(ring[0], ring.at(-1)) ? { type: 'Polygon', coordinates: [ring] } : null
  }
  const ways = (element.members ?? []).filter((m) => m.type === 'way' && m.geometry)
  const outers = assembleRings(ways.filter((m) => m.role !== 'inner').map((m) => line(m.geometry)))
  const inners = assembleRings(ways.filter((m) => m.role === 'inner').map((m) => line(m.geometry)))
  if (!outers.length) return null
  const polygons = outers.map((outer) => [outer])
  for (const inner of inners) polygons.find(([outer]) => inRing(inner[0], outer))?.push(inner)
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons }
}

function forestKind(tags) {
  if (tags.boundary === 'national_park' || tags.protect_class === '2') return 'national park'
  if (tags.leisure === 'nature_reserve') return 'nature reserve'
  if (tags.landuse === 'forest') return 'forest'
  if (tags.natural === 'wood') return 'wood'
  return 'protected area'
}

const displayName = (tags) => tags['name:en'] || tags['name:fr'] || tags.name

async function forests(iso3, country) {
  const box = country.reduce(
    (b, f) => polygonsOf(f.geometry).flat(2).reduce((c, [x, y]) => [Math.min(c[0], x), Math.min(c[1], y), Math.max(c[2], x), Math.max(c[3], y)], b),
    [180, 90, -180, -90],
  )
  const elements = new Map()
  for (const tile of tiles(box)) {
    const query = forestQuery(tile)
    const cached = path.join(CACHE, `overpass-${createHash('sha256').update(query).digest('hex').slice(0, 16)}.json`)
    let data = JSON.parse(await readFile(cached, 'utf8').catch(() => 'null'))
    if (!data) {
      data = await fetchJson(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }) })
      await mkdir(CACHE, { recursive: true })
      await writeFile(cached, JSON.stringify(data))
      await new Promise((resolve) => setTimeout(resolve, 2000)) // Overpass fair use: one query at a time, with a pause.
    }
    for (const element of data?.elements ?? []) elements.set(`${element.type}/${element.id}`, element)
  }
  const features = []
  for (const [key, element] of elements) {
    const tags = element.tags ?? {}
    // Cultural and social protection (heritage sites, monuments) are not landscapes that burn.
    if (/^2\d$/.test(tags.protect_class ?? '')) continue
    const geometry = elementGeometry(element)
    if (!geometry) continue
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        id: `osm-${key.replace('/', '-')}`,
        name: displayName(tags),
        name_fr: tags['name:fr'] ?? null,
        name_ar: tags['name:ar'] ?? null,
        level: 'forest',
        kind: forestKind(tags),
        iso3,
        source: 'OpenStreetMap (ODbL 1.0)',
        source_id: key,
      },
    })
  }
  if (!features.length) return []
  // Keep only what lies inside the country, then the largest place of each name.
  const clipped = await mapshaper.applyCommands(
    '-i forests.json country.json combine-files -clean target=forests -clip target=forests source=country -simplify interval=25 target=forests -clean target=forests -o forests.json target=forests format=geojson precision=0.0001',
    { 'forests.json': JSON.stringify(collection(features.map((f) => ({ ...f, properties: { id: f.properties.id } })))), 'country.json': JSON.stringify(collection(country)) },
  )
  const props = new Map(features.map((f) => [f.properties.id, f.properties]))
  const byName = new Map()
  for (const f of JSON.parse(clipped['forests.json'].toString()).features) {
    if (!f.geometry) continue
    const area = areaKm2(f.geometry)
    if (area < MIN_FOREST_KM2) continue
    const p = { ...props.get(f.properties.id), area_km2: Math.round(area * 10) / 10 }
    const key = p.name.trim().toLowerCase()
    if (!byName.has(key) || byName.get(key).properties.area_km2 < p.area_km2) byName.set(key, { type: 'Feature', properties: p, geometry: f.geometry })
  }
  const kept = [...byName.values()].sort((a, b) => b.properties.area_km2 - a.properties.area_km2).slice(0, MAX_FORESTS)
  return finish(kept)
}

async function country(iso3) {
  const dir = path.join(OUT, iso3)
  await mkdir(dir, { recursive: true })
  const summary = {}
  for (const level of ['region', 'province']) {
    const list = await units(iso3, level)
    if (!list) continue
    await writeFile(path.join(dir, `${level === 'region' ? 'regions' : 'provinces'}.json`), JSON.stringify(collection(list)))
    summary[level === 'region' ? 'regions' : 'provinces'] = list.length
  }
  const outline = await units(iso3, 'country')
  if (outline) {
    await writeFile(path.join(dir, 'country.json'), JSON.stringify(collection(outline)))
    const list = await forests(iso3, outline)
    await writeFile(path.join(dir, 'forests.json'), JSON.stringify(collection(list)))
    summary.forests = list.length
  }
  console.log(`${iso3}: ${JSON.stringify(summary)}`)
  return summary
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.length) {
    console.error('Usage: prepare.mjs countries | <ISO3> [<ISO3> …]')
    process.exit(1)
  }
  if (args[0] === 'countries') return countries()
  const indexPath = path.join(OUT, 'index.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8').catch(() => '{"countries":{}}'))
  for (const iso3 of args.map((a) => a.toUpperCase())) {
    if (!/^[A-Z]{3}$/.test(iso3)) throw new Error(`Not an ISO 3166 alpha-3 code: ${iso3}`)
    index.countries[iso3] = { ...(await country(iso3)), prepared: new Date().toISOString().slice(0, 10) }
  }
  index.geoboundaries = GB_COMMIT
  await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n')
}

await main()
