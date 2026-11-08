# FIREBRIDGE frontend

The FIREBRIDGE **Analysis workspace** at `/analyses` connects the public API to area creation, analysis/component monitoring, native MVT tiles and asynchronous exports. It also reads the published catalogue, release provenance, signed pages of native detections, daily inventory counts and analysis context. A factual note is prepared by the existing deterministic worker; no external AI service is called. API liveness and data readiness are independent, and failed requests never substitute demonstration data.

The application uses one responsive FIREBRIDGE shell across research and demonstration views. Its original dark blue identity comes directly from the unchanged `src/index.css`, `src/App.css` and `src/features/analyses/workspace.css`: backgrounds, cyan accents, secondary colors, gradients, borders, buttons and component states retain their original values. The earlier graphite/lime Astra theme has been removed. Source filters and pagination use the backend's saved analysis. Null FRP remains “Not measured”; unknown coverage and missing weather/reports remain explicit. Published synthetic releases retain their exact identifying names beside the results. See [the original integration report](INTEGRATION_REPORT.md), [the latest UI and phase verification report](../FIREBRIDGE_UI_PHASE_VALIDATION.md), and [the current UI/UX and original identity report](FIREBRIDGE_UI_UX_POLISH.md) for evidence and limitations.

The existing demonstration routes remain available. They use deterministic, explicitly synthetic fixtures and are labelled separately from the API workspace. NASA archival satellite imagery is the default geographic background. The API's MVT detection layer is requested only for an available satellite component.

The geospatial workspace now puts the map above collapsible configuration. Shared
source and UTC date filters drive loaded-record map inspection and the observation
table. Aggregate tiles always represent the full saved analysis; filtered mode
explicitly shows only loaded matching records, with signed pagination for more.
The timeline selects real returned periods, and source comparison preserves unknown
counts and lower bounds. Record details retain raw confidence schemes, acquisition
precision and null FRP. `/evidence` provides published provenance and an interpretation
guide; exports explain that inspection filters do not change the full saved export.
See [implementation and validation](GEOSPATIAL_TRANSFORMATION.md) for current checks
and remaining browser/live-integration limits.

The subsequent satellite and platform-wide pass adds real NASA imagery by default,
basemap/layer/fullscreen controls, cohesive page headers, technical table controls,
catalogue search and operator-session navigation. The latest complete page inventory,
production browser checks and provider limits are in
[the satellite platform report](SATELLITE_PLATFORM_REDESIGN.md).

## Run locally

The research dashboard is at `/dashboard`, the guided workflow is at `/analyses`, and the published data catalogue is at `/catalog`. `/api-analysis` retains the advanced results tools. Existing demonstration URLs, including `/`, retain their synthetic fixtures and are grouped separately in navigation. Dashboard counts describe loaded public server records, not account-specific or server-wide totals. Pagination follows the backend's identifier order; the analysis register prioritizes the newest timestamps among loaded records and initially shows eight rows.

Use an origin allowed by the backend's CORS policy. The existing local configuration permits `http://localhost:5173`, which is the default Vite origin; alternate preview ports are not automatically authorized.

```powershell
npm install
npm run dev
```

The app is built with React, TypeScript, Vite, MapLibre GL, Terra Draw, TanStack Query, and ECharts.

## Pages

- **Overview:** selection summary, activity charts, map, synthetic record table, and illustrative field notes.
- **Analysis workspace:** real API records, study areas, jobs, map tiles, observation tables, provenance, context, factual notes and CSV/GeoJSON/Parquet downloads.
- **Explore map:** selectable synthetic point features, a user-drawn local polygon, shared filters, and CSV export.
- **Compare sensors:** raw fixture counts, with harmonized response explicitly unavailable.
- **Activity calendar:** daily synthetic record counts and date selection.
- **Weather context, Reports & events, Analysis notes, and Watchlist:** honest unavailable states or clearly labeled illustrative content.
- **Data & methods and Preferences:** fixture provenance, scientific limitations, and local display/filter controls.
- **Data & methods (`/evidence`):** published catalogue, release tools and scientific interpretation guidance. Preferences continue to control the local demonstration.

Demonstration pages share inclusive date filters, platform selection, search, a minimum-FRP filter, and the selected area. Their local CSV export includes provenance and a synthetic-data indicator. The API workspace has independent forms and source filters, uses an exclusive UTC end date, and delegates export generation to the worker. Its area/analysis selection can be reopened from the page URL.

## Map configuration

MapLibre renders real, interactive raster imagery separately from the observation layers. The default background is NASA GIBS Blue Marble, an archival MODIS composite with native maximum zoom 8. Zooming farther enlarges those tiles; it does not add detail. It is geographic context, not imagery acquired with the selected wildfire records. Demonstration routes retain synthetic point records; the analysis workspace uses saved API results.

- **`VITE_MAP_STYLE_URL`** (optional, build/dev-time): a MapLibre-compatible style JSON URL. Copy `.env.example` to `.env.local` and set it. Do not commit provider keys; a key embedded in a URL is visible in the built bundle. The provider's attribution is shown through the map's attribution control and must not be hidden.
- **`VITE_BASEMAP_PROVIDER`**: `nasa-gibs` (default), `esri-world-imagery` (licensed opt-in), or `schematic` (offline, no background requests). Unsupported values produce an explicit configuration error and recovery choices.
- **Precedence:** `VITE_MAP_STYLE_URL` > `VITE_BASEMAP_PROVIDER` > NASA GIBS. NASA GIBS requires no API key. A custom provider can use a browser-safe, origin-restricted token in the environment-configured style URL; all `VITE_*` values are public, so never put private credentials there.
- **Basemap choices:** satellite; NASA satellite with OSM reference labels; OpenStreetMap streets; NASA shaded relief/bathymetry; and offline grid. Shaded relief is a raster context layer, not 3D terrain. A configured custom style remains selectable. Switching uses the existing MapLibre instance and restores study-area and detection layers.
- **Loading and failures:** after three initial imagery failures, denied style access or a 10-second timeout, the map shows an explicit **schematic / not satellite imagery** notice with retry and alternative-background actions. API detection failures remain separate. Partial tile failures retain loaded imagery with a notice. No alternative provider is contacted until the user selects it.
- **Map tools:** layer toggles, legend, zoom, north/pitch reset, study-area extent, polygon drawing and browser fullscreen. Fullscreen availability depends on the browser. No unsupported measurement tool is shown.
- Background imagery dates and observation acquisition times are independent. Visible provider attribution must remain on the map. Exports contain observation results, not basemap imagery. `/analyses`, `/api-analysis`, `/ingestion`, the catalogue and evidence use `VITE_API_URL` (default `http://localhost:3000/api/v1`).

NASA's [GIBS access documentation](https://nasa-gibs.github.io/gibs-api-docs/access-basics/) describes the public WMTS service and EPSG:3857 tile ordering. Layer identifiers, zoom matrices and the reference-label products were checked against live capabilities. Real NASA/Esri JPEG probes returned HTTP 200 with `Access-Control-Allow-Origin: *`; browser QA additionally loaded NASA tiles. NASA credit is shown with a link to the source. OSM streets follow the [public tile usage policy](https://operations.osmfoundation.org/policies/tiles/): visible attribution, normal browser caching, no prefetch/offline export or automated viewport scanning. Production traffic requiring an SLA should use an appropriately licensed configured provider.

### Esri World Imagery: terms reviewed and limits

Reviewed on the service's public ArcGIS item/REST metadata (`World_Imagery` MapServer): imagery is licensed under the **Esri Master License Agreement**; the required credit is **"Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"** (rendered by the attribution control, non-collapsed, and must not be removed); the layer is **not intended for tile export or offline use**, so this app never stores, caches or redistributes tiles (only the browser's normal HTTP cache applies); it is intended for use within ArcGIS apps, and Esri's terms (not re-read in full here) govern use from third-party apps, including any usage-based or commercial limits.

Esri is never enabled automatically. The [published usage summary](https://goto.arcgis.com/termsofuse/viewsummary) requires appropriate Esri software/subscription or platform licensing; public tile access alone is not a licence, even for a local demonstration. Verify your entitlement before setting `VITE_BASEMAP_PROVIDER=esri-world-imagery`; commercial Living Atlas use can require separate licensing. Imagery dates vary, are not provided by this frontend and imply nothing about detections or observation support.

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

The original ten-operation integration is documented in [the backend delivery report](../firebridge-backend/docs/INTEGRATION_REPORT.md). The frontend integration is documented in [the current frontend report](INTEGRATION_REPORT.md), while the catalogue and additional phase 1/3/5/6 services are documented in [the frontend integration guide](INTEGRATION_PHASES_1_3_5_6.md). All services use the existing /api/v1 prefix.

Install the backend workspace dependencies first (npm ci in "../firebridge-backend"), then npm ci here. The predev/prebuild scripts compile the existing shared contracts package. VITE_API_URL defaults to http://localhost:3000/api/v1; copy .env.example to .env.local to override public build-time settings. Invalid URLs fail early.

A single Axios instance lives in src/lib/axios.ts. Public services send no authentication, tokens, identity headers or authentication cookies. Only the five ingestion administration operations attach a temporary, manually entered bearer token; it is never stored in Vite configuration or Axios defaults. One QueryClient lives in src/lib/queryClient.ts and is used by the existing App provider. Services are in src/services; the original ten hooks are in src/hooks/useFirebridge.ts and the additional hooks are in useDataApi.ts and useIngestion.ts. Read hooks share in-flight queries and cancellation signals. Analysis/export mutations require a UUID idempotency key created with createIdempotencyKey(). Write mutations retain their idempotency key when explicitly retrying the same intent. Mutation retries are explicit.

Downloads first read the public job endpoint to obtain its short-lived signed link. These links expire within five minutes and do not represent a user permission. Consultation resources remain public; ingestion administration requires its technical bearer token.

Open /api-analysis for backend analysis results, /evidence for catalogue/version/source inspection, and /ingestion for administration. Existing maps and charts still use synthetic local fixtures. The UI creates an explanation request, reads its state through GET /explanations/{id}, and displays the result when it is validated or available as a deterministic template fallback.

Run npm run build, npm test and npm run lint here. The optional HTTP suite is skipped in ordinary unit tests; run node scripts/integration/run.mjs from the backend to provision an isolated test database and exercise real Axios/PostGIS/Redis/Worker processing. Synthetic TEST ONLY observations stay exclusively in that test database.
