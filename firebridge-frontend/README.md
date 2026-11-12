# FIREBRIDGE frontend

React/TypeScript application, built with Vite and served by Nginx in Docker.

- `src/pages` and `src/features`: screens and features.
- `src/hooks`: data access with TanStack Query.
- `src/services`: Axios HTTP calls to the Fastify API.
- `src/components`: shared components and the MapLibre map.

The `@firebridge/contracts` package comes from
`../firebridge-backend/packages/contracts`. Keep these folder names.
See the [main README](../README.md) for the Docker build and API configuration.
Private `.env` files are not included in the repository.

## Data visualization

Open **Data visualization** in the sidebar (`/visualization`) and select a saved
native-detection analysis. The selector follows all analysis-list pages
automatically. Two date inputs restrict the UTC interval to the saved study;
the visible end date is inclusive and is sent to the API as an exclusive boundary.

Seven D3 views complement the existing analysis workspace: inventory continuity,
monthly distributions, paired source counts, monthly composition, year-over-year
differences, ranked concentration and seasonal similarity. Source and year
selectors control the relevant plots. Charts adapt to their container width;
each available chart can be downloaded as SVG, and the exact-count table as CSV.

These plots describe **native detection records**, not unique fires or harmonized
burning activity. Complete inventory, lower-bound counts and unknown counts remain
distinct. Statistics use exact full months; insufficient samples and missing data
produce explanatory empty states. Links open the same saved study's existing
harmonized fire calendar and sensor bridge.

The feature uses the existing API services and does not change the backend,
database, ingestion pipeline or AI explainer. Its components, calculations and
styles live in `src/features/visualization`; `src/pages/VisualizationPage.tsx`
provides the page and `src/hooks/useAllWorkspaceAnalyses.ts` loads the selector.

After installing dependencies in both folders, run from `firebridge-frontend`:

```sh
npm run build
npm run lint
npm test
npm run test:visualization
```

The browser test uses a controlled two-year fixture, starts a temporary preview
on port 5174 and checks all seven charts at widths from 320 to 1920 pixels,
keyboard inspection and SVG export. It contacts no database, NASA or AI service.
It uses Microsoft Edge on Windows; on Linux, install Playwright's Chromium first
with `npx playwright install --with-deps chromium`. Generated output stays in
the ignored `.qa` directory. Fixture checks establish UI behavior, not scientific
validation of a real archive.
