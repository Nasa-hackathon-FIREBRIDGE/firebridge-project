/**
 * Verified figures and citations behind the Data & methods and Sources pages.
 *
 * Every number here comes from a dated receipt in the FIREBRIDGE data pipeline repository
 * (github.com/Nasa-hackathon-FIREBRIDGE/FireBridge-data-pipeline): the archive audit of
 * 9 Nov 2026 (`.deploy/history-preparation-results.md`), the historical-serving design
 * (`docs/data/HISTORICAL_ANALYSES.md`) and the project overview of the same date. Update the
 * figures together with their date when a newer audit is published; never edit one alone.
 */
import { HISTORICAL_MAX_WINDOW_DAYS } from '@firebridge/contracts/analysis-limits'
import type { SensorKey } from '../../lib/sensors'

export const AUDIT_DATE = '9 Nov 2026'
export const PIPELINE_REPO = 'https://github.com/Nasa-hackathon-FIREBRIDGE/FireBridge-data-pipeline'

export interface ArchivePlatform {
  key: Exclude<SensorKey, 'other'>
  name: string
  instrument: string
  /** Inclusive first and last record dates in the downloaded snapshot (standard + NRT tail). */
  first: string
  last: string
  rows: number
  /** Whether FIREBRIDGE analyses read this platform. */
  used: boolean
}

export const ARCHIVE: ArchivePlatform[] = [
  { key: 'terra', name: 'Terra', instrument: 'MODIS', first: '2000-11-01', last: '2026-11-06', rows: 40_966_054, used: true },
  { key: 'aqua', name: 'Aqua', instrument: 'MODIS', first: '2002-07-04', last: '2026-11-06', rows: 74_154_093, used: true },
  { key: 'snpp', name: 'Suomi-NPP', instrument: 'VIIRS', first: '2012-01-20', last: '2026-11-02', rows: 298_044_645, used: true },
  { key: 'noaa20', name: 'NOAA-20', instrument: 'VIIRS', first: '2018-04-01', last: '2026-11-06', rows: 173_282_297, used: true },
  { key: 'noaa21', name: 'NOAA-21', instrument: 'VIIRS', first: '2023-03-01', last: '2026-11-06', rows: 73_447_577, used: true },
  { key: 'landsat', name: 'Landsat 8 & 9', instrument: 'OLI', first: '2022-06-20', last: '2026-11-06', rows: 3_350_095 + 3_611_722, used: false },
]

export const ARCHIVE_TOTAL_ROWS = 666_856_483
export const AUDITED_WINDOWS = 4_202
export const INDEXED_WINDOWS = 3_808
export const INVALID_FRP_VALUES = 28
export const EMPTY_WINDOWS = 21
export const UNLABELLED_MODIS_WINDOWS = 3
export const ARCHIVE_GIB = 23.29
/** The server's own limit, shared through the contracts package so this page cannot drift from it. */
export const MAX_ANALYSIS_DAYS = HISTORICAL_MAX_WINDOW_DAYS
export const MOROCCO_2020_SECONDS = 4.7
export const MOROCCO_2020_BEFORE_SECONDS = 25.5

export const usedRows = ARCHIVE.filter((platform) => platform.used).reduce((sum, platform) => sum + platform.rows, 0)

/** "2000-11-01" → "Nov 2000". */
export function monthYear(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** 298044645 → "298.0 M". */
export function millions(value: number) {
  return `${(value / 1_000_000).toFixed(1)} M`
}

export interface Citation {
  name: string
  role: string
  /** DOI without the resolver prefix; each was checked to resolve at doi.org on 11 Nov 2026. */
  doi?: string
  href?: string
  licence?: string
  /** A short label shown like a licence chip, for entries that are not licensed material. */
  tag?: string
}

export const FIRE_PRODUCTS: Citation[] = [
  { name: 'MODIS/Terra Thermal Anomalies/Fire (MOD14), Collection 6.1', role: 'Science product behind the Terra standard records', doi: '10.5067/MODIS/MOD14.061' },
  { name: 'MODIS/Aqua Thermal Anomalies/Fire (MYD14), Collection 6.1', role: 'Science product behind the Aqua standard records', doi: '10.5067/MODIS/MYD14.061' },
  { name: 'FIRMS MODIS standard archive (MCD14ML)', role: 'Terra and Aqua point records, as distributed by FIRMS', doi: '10.5067/FIRMS/MODIS/MCD14ML' },
  { name: 'VIIRS/Suomi-NPP Active Fires 375 m (VNP14IMG), version 2', role: 'Science product behind the Suomi-NPP standard records', doi: '10.5067/VIIRS/VNP14IMG.002' },
  { name: 'VIIRS/NOAA-20 Active Fires 375 m (VJ114IMG), version 2', role: 'Science product behind the NOAA-20 standard records', doi: '10.5067/VIIRS/VJ114IMG.002' },
  { name: 'VIIRS/NOAA-21 Active Fires 375 m (VJ214IMG), version 2', role: 'Science product behind the NOAA-21 standard records', doi: '10.5067/VIIRS/VJ214IMG.002' },
]

export const NRT_PRODUCTS: Citation[] = [
  { name: 'MODIS Collection 6.1 near-real-time (MCD14DL)', role: 'Archived recent tail; not used in analyses', doi: '10.5067/FIRMS/MODIS/MCD14DL.NRT.0061' },
  { name: 'VIIRS Suomi-NPP 375 m near-real-time', role: 'Archived recent tail; not used in analyses', doi: '10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002' },
  { name: 'VIIRS NOAA-20 375 m near-real-time', role: 'Archived recent tail; not used in analyses', doi: '10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002' },
  { name: 'VIIRS NOAA-21 375 m near-real-time', role: 'Archived recent tail; not used in analyses', doi: '10.5067/FIRMS/VIIRS/VJ214IMGT_NRT.002' },
]

export const FIRE_DOCUMENTATION: Citation[] = [
  { name: 'NASA FIRMS', role: 'Distributes every fire detection FIREBRIDGE uses. Part of NASA’s Earth Science Data and Information System (ESDIS).', href: 'https://www.earthdata.nasa.gov/data/tools/firms' },
  { name: 'FIRMS API: area, data availability', role: 'How records were requested: five-day, worldwide windows after an availability check', href: 'https://firms.modaps.eosdis.nasa.gov/api/' },
  { name: 'FIRMS active fire data attributes (MODIS, VIIRS)', role: 'Meaning of every native field we keep', href: 'https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs' },
  { name: 'MODIS Collection 6/6.1 Active Fire User’s Guide', role: 'Confidence classes, fire types and known limitations', href: 'https://www.earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf' },
]

export const IMAGERY: Citation[] = [
  { name: 'NASA GIBS · Blue Marble Next Generation', role: 'Default satellite basemap', href: 'https://nasa-gibs.github.io/gibs-api-docs/', licence: 'NASA open data' },
  { name: 'OpenStreetMap', role: 'Optional street basemap · © OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0' },
]

export const BOUNDARIES: Citation[] = [
  { name: 'geoBoundaries (gbOpen)', role: 'Regions and provinces in the place picker, pinned to commit 9469f09', href: 'https://www.geoboundaries.org/', licence: 'ODbL 1.0' },
  { name: 'Natural Earth 10 m admin-0', role: 'Country outlines in the place picker', href: 'https://www.naturalearthdata.com/', licence: 'Public domain' },
  { name: 'OpenStreetMap via Overpass', role: 'Forests and protected areas in the place picker', href: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0' },
]

/** Licences checked 11 Nov 2026: Hugging Face model cards for Qwen and gpt-oss; Groq's model page for ALLaM. */
export const LANGUAGE_MODELS: Citation[] = [
  { name: 'GroqCloud API', role: 'Runs the models below. FIREBRIDGE calls it from its own server; your browser never talks to it.', href: 'https://console.groq.com/docs/models', licence: 'Groq terms' },
  { name: 'Qwen3.8 27B (Alibaba Qwen)', role: 'Primary model for explanations', href: 'https://huggingface.co/Qwen/Qwen3.8-27B', licence: 'Apache-2.0' },
  { name: 'gpt-oss-120b and gpt-oss-20b (OpenAI)', role: 'Open-weight models, used in turn when the primary is at its rate limit', href: 'https://huggingface.co/openai/gpt-oss-120b', licence: 'Apache-2.0' },
  { name: 'ALLaM 2 7B (SDAIA)', role: 'Housekeeping only (conversation summaries); never writes answers', href: 'https://console.groq.com/docs/model/allam-2-7b', licence: 'Humain terms' },
]

/**
 * AI tools used to build FIREBRIDGE, as confirmed by the team on 11 Nov 2026. Repository traces agree:
 * 40 app commits are co-authored by Claude Sonnet 4.6 (the 9 Nov interface redesign), and the data
 * pipeline's presentation builder runs inside a Codex runtime. Required by the 2026 Space Apps FAQ.
 */
export const DEVELOPMENT_AI: Citation[] = [
  {
    name: 'Claude Code (Anthropic)',
    role: 'With Claude Sonnet 4.6 and Claude Opus 5.5. Used to write and test much of the web application and API: the interface, fire calendar, harmonization lab, place picker, copilot, explanation service and these pages.',
    href: 'https://claude.com/product/claude-code',
    tag: 'Web app & API',
  },
  {
    name: 'OpenAI Codex',
    role: 'Used to write code and documentation for the data pipeline (FIRMS download, audit, indexing and publication) and its exploratory MODIS analysis.',
    href: 'https://developers.openai.com/codex',
    tag: 'Data pipeline',
  },
]

export const APP_REPO = 'https://github.com/Nasa-hackathon-FIREBRIDGE/firebridge-project'
export const AGENT_REPO = 'https://github.com/Nasa-hackathon-FIREBRIDGE/FireBridge-AI-Agent'

export const OUR_CODE: Citation[] = [
  { name: 'FIREBRIDGE web application and API', role: 'This website, its API, workers and the in-browser harmonization engine', href: APP_REPO, licence: 'MIT' },
  { name: 'FIREBRIDGE data pipeline', role: 'Download, audit, indexing and publication of the NASA FIRMS archive', href: PIPELINE_REPO, licence: 'MIT' },
  { name: 'FIREBRIDGE explanation service', role: 'The copilot’s agent: facts computed in code, models that only phrase them, every number checked', href: AGENT_REPO, licence: 'MIT' },
]

export interface SoftwareGroup {
  title: string
  items: [name: string, licence: string][]
}

/** Licences read from each installed package's metadata on 11 Nov 2026. */
export const SOFTWARE: SoftwareGroup[] = [
  {
    title: 'Web application',
    items: [
      ['React', 'MIT'], ['React Router', 'MIT'], ['TanStack Query', 'MIT'], ['MapLibre GL JS', 'BSD-3-Clause'], ['Terra Draw', 'MIT'],
      ['Apache ECharts', 'Apache-2.0'], ['Motion', 'MIT'], ['Radix UI', 'MIT'], ['Lucide icons', 'ISC'], ['polygon-clipping', 'MIT'],
      ['Axios', 'MIT'], ['Tailwind CSS', 'MIT'], ['Vite', 'MIT'],
    ],
  },
  {
    title: 'Fonts',
    items: [['Inter', 'OFL-1.1'], ['Space Grotesk', 'OFL-1.1'], ['JetBrains Mono', 'OFL-1.1']],
  },
  {
    title: 'API and workers',
    items: [
      ['Fastify', 'MIT'], ['Prisma', 'Apache-2.0'], ['BullMQ', 'MIT'], ['Zod', 'MIT'], ['node-postgres', 'MIT'],
      ['ioredis', 'MIT'], ['Pino', 'MIT'], ['parquetjs-lite', 'MIT'],
    ],
  },
  {
    title: 'Data platform',
    items: [
      ['Apache Airflow', 'Apache-2.0'], ['dbt Core', 'Apache-2.0'], ['DuckDB', 'MIT'], ['Apache Arrow (PyArrow)', 'Apache-2.0'],
      ['pandas', 'BSD-3-Clause'], ['HTTPX', 'BSD-3-Clause'], ['psycopg', 'LGPL-3.0'], ['pyproj', 'MIT'],
      ['PostgreSQL', 'PostgreSQL'], ['PostGIS', 'GPL-2.0'],
    ],
  },
  {
    title: 'Explanation service',
    items: [['FastAPI', 'MIT'], ['Uvicorn', 'BSD-3-Clause'], ['Pydantic', 'MIT'], ['aiosqlite', 'MIT']],
  },
]

/** Weather beside fire: read in the browser for the Fire drivers page and the calendar's weather check. */
export const WEATHER: Citation[] = [
  {
    name: 'NASA POWER (Prediction Of Worldwide Energy Resources)',
    role: 'Daily maximum temperature and precipitation at the centre of each analysis’s fire activity, read from the POWER API. Data obtained from the NASA Langley Research Center POWER Project.',
    href: 'https://power.larc.nasa.gov/',
    tag: 'NASA LaRC',
  },
  {
    name: 'MERRA-2 reanalysis (Gelaro et al. 2017)',
    role: 'The NASA GMAO reanalysis behind POWER’s daily meteorology, on a grid of roughly 50 km.',
    doi: '10.1175/JCLI-D-16-0758.1',
  },
]
