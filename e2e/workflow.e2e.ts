import { readFile } from 'node:fs/promises'
import { test, expect, visit, actionResponse, endpoint, apiURL, ids } from './fixtures'

test('creates a zone, blocks an inverted interval, runs an analysis and reopens its saved URL', async ({ page, request }, info) => {
  await visit(page, '/analyses')
  const areaForm = page.locator('#area-create-form')
  await areaForm.locator('input[name="name"]').fill('TEST ONLY - browser workflow')
  await page.getByText('Area metadata · version, timezone and provenance', { exact: true }).click()
  await areaForm.locator('input[name="version"]').fill('browser-' + Date.now())
  await page.getByText('Paste GeoJSON · advanced', { exact: true }).click()
  await page.getByLabel('GeoJSON Polygon', { exact: true }).fill(JSON.stringify({
    type: 'Polygon', coordinates: [[[-8, 30], [-7, 30], [-7, 31], [-8, 31], [-8, 30]]],
  }))
  const area = await actionResponse(page,
    () => areaForm.locator('button[type="submit"]').click(), endpoint('/areas', 'POST'))
  await expect(page).toHaveURL(new RegExp('area=' + area.id))
  await page.getByRole('button', { name: 'Open analysis date picker', exact: true }).click()
  const analysisForm = page.locator('#analysis-create-form')
  await analysisForm.locator('input[name="start"]').fill('2024-01-20')
  await analysisForm.locator('input[name="end"]').fill('2024-01-17')
  await expect(analysisForm.locator('button[type="submit"]')).toBeDisabled()
  await analysisForm.locator('input[name="start"]').fill('2024-01-17')
  await analysisForm.locator('input[name="end"]').fill('2024-01-20')
  await page.keyboard.press('Escape')
  const analysis = await actionResponse(page,
    () => analysisForm.locator('button[type="submit"]').click(), endpoint('/analyses', 'POST'))
  expect(analysis.metric_key).toBe('native_detections_v1')
  expect(analysis.grid_id).toBeNull()
  await expect(page).toHaveURL(new RegExp('analysis=' + analysis.id))
  await expect.poll(async () =>
    (await (await request.get(apiURL + '/analyses/' + analysis.id)).json()).data.status,
  { timeout: 25_000 }).toMatch(/^(ready|partial)$/)
  await page.getByRole('tab', { name: 'Observations', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Observation records', exact: true })).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Observation records', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('created-analysis.png'), fullPage: true })
})

test('renders the map and receives nonempty real MVT tiles', async ({ page }) => {
  const tile = page.waitForResponse(async (response) =>
    endpoint('/analyses/' + ids.native + '/tiles/detections/')(response) &&
    response.status() === 200 && (await response.body()).byteLength > 0,
  { timeout: 30_000 })
  await visit(page, '/analyses?analysis=' + ids.native)
  await page.getByRole('button', { name: 'Choose basemap', exact: true }).click()
  await page.getByRole('combobox', { name: 'Basemap', exact: true }).selectOption('schematic')
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
  const response = await tile
  expect(response.headers()['content-type']).toContain('application/vnd.mapbox-vector-tile')
})

for (const format of ['csv', 'geojson', 'parquet']) {
  test('prepares and downloads ' + format + ' through the real worker', async ({ page }) => {
    await visit(page, '/analyses?analysis=' + ids.native)
    await page.getByRole('tab', { name: 'Exports', exact: true }).click()
    await page.getByRole('combobox', { name: 'File format', exact: true }).selectOption(format)
    const job = await actionResponse(page,
      () => page.getByRole('button', { name: 'Prepare export', exact: true }).click(),
      endpoint('/analyses/' + ids.native + '/exports', 'POST'))
    const downloadButton = page.getByRole('button', { name: 'Download file', exact: true })
    await expect(downloadButton).toBeEnabled({ timeout: 25_000 })
    const downloading = page.waitForEvent('download')
    await downloadButton.click()
    const download = await downloading
    expect(download.suggestedFilename()).toContain(job.job_id)
    expect(await download.failure()).toBeNull()
    const bytes = await readFile((await download.path())!)
    expect(bytes.byteLength).toBeGreaterThan(0)
    if (format === 'csv') expect(bytes.toString('utf8').trim().split('\n')).toHaveLength(4)
    if (format === 'geojson') expect(JSON.parse(bytes.toString('utf8')).features).toHaveLength(3)
    if (format === 'parquet') expect(bytes.subarray(0, 4).toString()).toBe('PAR1')
    await expect(page.getByText('File handed to your browser for download.')).toBeVisible()
  })
}
