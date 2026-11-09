import { test, expect, visit, actionResponse, endpoint, apiURL, ids } from './fixtures'

for (const id of [ids.native, ids.prepared]) {
  test('opens every structured result tab for ' + id, async ({ page }) => {
    await visit(page, '/api-analysis?analysis=' + id)
    const tabs = page.getByRole('tablist', { name: 'Résultats d’analyse' })
    await expect(tabs.getByRole('tab')).toHaveCount(10)
    for (const name of ['Résumé', 'Détections', 'Calendrier', 'Provenance', 'Couverture',
      'Cellule', 'Comparaison', 'Météo', 'Rapports', 'Explication']) {
      const tab = tabs.getByRole('tab', { name, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      const content = page.getByRole('tabpanel', { name, exact: true })
      await expect(content).toBeVisible()
      if (!['Cellule', 'Explication'].includes(name))
        await expect(content.getByText(/État des données/).first()).toBeVisible()
    }
  })
}

test('native observations apply source and UTC filters to the record inspection', async ({ page }) => {
  await visit(page, '/analyses?analysis=' + ids.native)
  await page.getByRole('tab', { name: 'Observations', exact: true }).click()
  await page.getByRole('combobox', { name: 'Filter observation source' }).selectOption('terra')
  await page.getByRole('button', { name: 'Open observation filter date picker', exact: true }).click()
  await page.getByLabel('Observation start date', { exact: true }).fill('2024-01-17')
  const data = await actionResponse(page,
    () => page.getByLabel('Observation end date exclusive', { exact: true }).fill('2024-01-18'),
    (r) => endpoint('/analyses/' + ids.native + '/detections')(r) &&
      new URL(r.url()).searchParams.get('end_exclusive') === '2024-01-18T00:00:00Z')
  expect(data.features.length).toBeGreaterThan(0)
  expect(data.features.every((row: { properties: { source_id: string; acquired_at: string } }) =>
    row.properties.source_id === 'terra' && row.properties.acquired_at.startsWith('2024-01-17'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('table', { name: /Native detection records/i })).toBeVisible()
})

test('timeline changes actual server grouping between day, week and month', async ({ page }) => {
  await visit(page, '/analyses?analysis=' + ids.native)
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click()
  const panel = page.locator('#panel-temporal-analysis')
  for (const resolution of ['week', 'month']) {
    const data = await actionResponse(page,
      () => panel.getByRole('combobox', { name: 'Regroupement du calendrier' }).selectOption(resolution),
      (r) => endpoint('/analyses/' + ids.native + '/calendar')(r) &&
        new URL(r.url()).searchParams.get('resolution') === resolution)
    expect(data.resolution).toBe(resolution)
    await expect(panel.locator('.geo-timeline')).toBeVisible()
  }
  // The day query was already cached by the map workspace; returning to it need not send HTTP.
  await panel.getByRole('combobox', { name: 'Regroupement du calendrier' }).selectOption('day')
  await expect(panel.locator('.geo-timeline > button')).toHaveCount(3)
})

test('prepared cell and source comparison expose supported and unsupported resolutions', async ({ page }) => {
  await visit(page, '/api-analysis?analysis=' + ids.prepared)
  await page.getByRole('tab', { name: 'Cellule', exact: true }).click()
  const cell = page.getByRole('tabpanel', { name: 'Cellule', exact: true })
  await cell.locator('input[name="cell"]').fill('6001')
  const detail = await actionResponse(page,
    () => cell.getByRole('button', { name: 'Consulter la cellule' }).click(),
    endpoint('/analyses/' + ids.prepared + '/cells/6001'))
  expect(detail.observations.length).toBeGreaterThan(0)
  await page.getByRole('tab', { name: 'Comparaison', exact: true }).click()
  const comparison = page.getByRole('tabpanel', { name: 'Comparaison', exact: true })
  await comparison.locator('select[name="view"]').selectOption('common_response')
  const unsupported = await actionResponse(page,
    () => comparison.getByRole('button', { name: 'Appliquer les filtres' }).click(),
    (r) => endpoint('/analyses/' + ids.prepared + '/comparison')(r) &&
      new URL(r.url()).searchParams.get('view') === 'common_response')
  expect(unsupported.status).toBe('unsupported')
  await comparison.locator('select[name="resolution"]').selectOption('month')
  const supported = await actionResponse(page,
    () => comparison.getByRole('button', { name: 'Appliquer les filtres' }).click(),
    (r) => endpoint('/analyses/' + ids.prepared + '/comparison')(r) &&
      new URL(r.url()).searchParams.get('resolution') === 'month')
  expect(supported.status).toBe('ready')
  await expect(comparison).toContainText('source_response_fixture')
})

test('context details load on selection, preserve filters and report missing weather honestly', async ({ page }) => {
  await visit(page, '/analyses?analysis=' + ids.prepared)
  await page.getByRole('tab', { name: 'Context & notes', exact: true }).click()
  const context = page.getByRole('region', { name: 'Détails du contexte d’analyse' })
  await context.getByRole('tab', { name: 'Météo', exact: true }).click()
  const weather = context.getByRole('tabpanel', { name: 'Météo', exact: true })
  await expect(weather).toContainText('missing')
  await weather.locator('select[name="resolution"]').selectOption('day')
  await weather.getByRole('button', { name: 'Appliquer les filtres' }).click()
  await context.getByRole('tab', { name: 'Couverture', exact: true }).click()
  await context.getByRole('tab', { name: 'Météo', exact: true }).click()
  await expect(weather.locator('select[name="resolution"]')).toHaveValue('day')
})

test('worker creates a factual French explanation through the browser', async ({ page, request }) => {
  await visit(page, '/api-analysis?analysis=' + ids.native)
  await page.getByRole('tab', { name: 'Explication', exact: true }).click()
  const panel = page.getByRole('tabpanel', { name: 'Explication', exact: true })
  const result = await actionResponse(page,
    () => panel.getByRole('button', { name: 'Demander la synthèse' }).click(),
    endpoint('/analyses/' + ids.native + '/explanations', 'POST'))
  expect(result.explanation_id).toBeTruthy()
  await expect(panel.getByRole('heading', { name: /Résumé factuel/ })).toBeVisible({ timeout: 25_000 })
  const detail = (await (await request.get(apiURL + '/explanations/' + result.explanation_id)).json()).data
  expect(detail.status).toBe('template_fallback')
  expect(detail.language).toBe('fr')
  await expect(panel).toContainText('Comptage inconnu pour cette source.')
})
