# ASTRA MIND frontend

ASTRA MIND's existing interface uses deterministic, explicitly synthetic fixtures to demonstrate a fire-observation exploration workflow. The public FIREBRIDGE API client, services and hooks are implemented separately and have real HTTP integration tests; they are not connected to the visual pages yet. The displayed points remain synthetic. Map tiles are requested only if you configure `VITE_MAP_STYLE_URL` (see below).

## Run locally

```powershell
npm install
npm run dev
```

The app is built with React, TypeScript, Vite, MapLibre GL, Terra Draw, TanStack Query, and ECharts.

## Pages

- **Overview:** selection summary, activity charts, map, synthetic record table, and illustrative field notes.
- **Explore map:** selectable synthetic point features, a user-drawn local polygon, shared filters, and CSV export.
- **Compare sensors:** raw fixture counts, with harmonized response explicitly unavailable.
- **Activity calendar:** daily synthetic record counts and date selection.
- **Weather context, Reports & events, Analysis notes, and Watchlist:** honest unavailable states or clearly labeled illustrative content.
- **Data & methods and Preferences:** fixture provenance, scientific limitations, and local display/filter controls.

All pages share inclusive date filters, platform selection, search, a minimum-FRP filter, and the selected area. CSV export includes provenance and a synthetic-data indicator.

## Map configuration

The map is a MapLibre GL JS map showing the same filtered synthetic records as the charts and tables (MODIS-style teal, VIIRS-style orange, selected record enlarged).

- **`VITE_MAP_STYLE_URL`** (optional, build/dev-time): a MapLibre-compatible style JSON URL. Copy `.env.example` to `.env.local` and set it. Do not commit provider keys; a key embedded in a URL is visible in the built bundle. The provider's attribution is shown through the map's attribution control and must not be hidden.
- **`VITE_BASEMAP_PROVIDER`** (optional): set to `esri-world-imagery` to opt in to Esri's World Imagery raster tiles. Any other non-empty value is rejected and the schematic is used (no silent substitution).
- **Precedence:** `VITE_MAP_STYLE_URL` > `VITE_BASEMAP_PROVIDER` > schematic. With neither set, **no external map or tile request is made**.
- **No style URL or provider, or the style fails/times out (10 s):** the app switches to a clearly labelled **schematic view** (dark background with a 1° longitude/latitude grid). A banner states that it is not satellite imagery and that the real basemap is unavailable. No other map provider is contacted as a substitute, and loading never spins indefinitely. Errors after a style has loaded (for example one tile) do not trigger the fallback.
- **Esri tile failures:** if three tile requests fail before any tile loads, the app falls back to the schematic and says why. If tiles fail after some loaded, imagery stays and a small notice appears.
- The app itself makes no NASA or other API calls. With a style URL or provider configured, the browser requests that style and its tiles from that provider.

### Esri World Imagery: terms reviewed and limits

Reviewed on the service's public ArcGIS item/REST metadata (`World_Imagery` MapServer): imagery is licensed under the **Esri Master License Agreement**; the required credit is **"Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"** (rendered by the attribution control, non-collapsed, and must not be removed); the layer is **not intended for tile export or offline use**, so this app never stores, caches or redistributes tiles (only the browser's normal HTTP cache applies); it is intended for use within ArcGIS apps, and Esri's terms (not re-read in full here) govern use from third-party apps, including any usage-based or commercial limits.

This option is intended for local, non-commercial demonstrations only. **Before any public deployment, commercial use, or heavy traffic, confirm Esri's current terms and use an Esri/ArcGIS Location Platform account and API key** (not supplied or hard-coded here), or choose another licensed provider through `VITE_MAP_STYLE_URL`. Imagery is background context only: it has an unknown acquisition date, is not Aqua/Suomi-NPP data, and implies nothing about detections or observation support.

### Area drawing (Terra Draw)

Use the dashed-square button to draw a polygon: click to add vertices, then press the **Finish drawing** button (enabled from three vertices; the hint shows progress) or Enter. Cancel with the Cancel button, the X button or Esc. The trash button clears the selected area and restores the default demonstration extent. The result is stored in shared state as a GeoJSON `Polygon` in WGS 84 longitude/latitude and filters the records by point-in-polygon. Polygons are validated (closed, at least three distinct vertices, finite and in-range coordinates, non-zero area, no self-intersection); invalid ones are rejected with a message. When drawn in the schematic view, the area is labelled "schematic, unverified" because there is no real basemap to confirm its location.

### Bundle size

The map and chart code is lazy-loaded per route, so the initial bundle excludes MapLibre. The map chunk remains large because of MapLibre GL itself. The Vite warning reports raw minified sizes: MapView ≈1.17 MB (≈317 KB gzip), Charts ≈559 KB (≈188 KB gzip).

### Browser QA

All ten routes and the map/drawing workflow were exercised in headless Chromium (software WebGL) at 1920×1080, 1366×768, 1024×768 and 390×844, both with the schematic fallback (no external requests) and with `VITE_BASEMAP_PROVIDER=esri-world-imagery`, where Esri tiles were actually requested (HTTP 200) and rendered with attribution during one session. That is a point-in-time check, not a guarantee of Esri's terms or availability.

### Test scope

`MapView.test.tsx` runs against mocked `maplibre-gl` and `terra-draw` in jsdom (no WebGL). It covers initialization, missing or failed style handling, filtering, selection, drawing, cleanup and resizing of MapView's own logic. It does **not** verify live basemap loading or real rendering.

## Scientific limitations

This frontend does not contain NASA granules, complete fire masks, per-pixel geolocation or time, QA fields, valid observation support, common-grid matching, or a validated harmonization model. Counts are point-record counts only. Missing detection points are never presented as valid negative observations. The unresolved VNP14IMG Collection 2 full-mask geolocation-companion question remains unchanged by this UI.

`src/data.ts` is a local demo repository adapter. Replacing it with an API adapter requires a separate implementation and scientific review; the current UI must not be interpreted as proof that the proposed backend or architecture is implemented.

## Checks

```powershell
npm run test
npm run lint
npm run build
```

## FIREBRIDGE API integration

The technical integration is documented in [the backend delivery report](../firebridge-backend/docs/INTEGRATION_REPORT.md). All ten API routes use the existing /api/v1 prefix.

Install the backend workspace dependencies first (npm ci in ../firebridge-backend), then npm ci here. The predev/prebuild scripts compile the existing shared contracts package. VITE_API_URL defaults to http://localhost:3000/api/v1; copy .env.example to .env.local to override public build-time settings. Invalid URLs fail early.

A single Axios instance lives in src/lib/axios.ts. It uses no authentication, tokens, identity headers or authentication cookies. One QueryClient lives in src/lib/queryClient.ts and is used by the existing App provider. Services are in src/services; the ten hooks are in src/hooks/useFirebridge.ts. Read hooks share in-flight queries and cancellation signals. Analysis/export mutations require a UUID idempotency key created with createIdempotencyKey(); retain the same key when retrying the same intent. Mutation retries are explicit.

Downloads first read the public job endpoint to obtain its short-lived signed link. These links expire within five minutes and do not represent a user permission. The API and all resources in scope are public to anyone who can reach the server.

Run npm run build, npm test and npm run lint here. The optional HTTP suite is skipped in ordinary unit tests; run node scripts/integration/run.mjs from the backend to provision an isolated test database and exercise real Axios/PostGIS/Redis/Worker processing. Synthetic TEST ONLY observations stay exclusively in that test database.
