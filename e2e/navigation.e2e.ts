import { test, expect, visit, actionResponse, endpoint, noPageOverflow, ids } from './fixtures'

for (const path of ['/', '/dashboard', '/analyses', '/api-analysis', '/catalog', '/evidence',
  '/ingestion', '/demo', '/explore', '/compare', '/calendar', '/weather', '/reports', '/explain',
  '/alerts', '/settings']) {
  test('opens ' + path + ' without an application exception', async ({ page }) => {
    await visit(page, path)
    await expect(page.locator('body')).not.toContainText('Unexpected API response data.')
  })
}

test('dashboard lists saved analyses, filters by status and opens a record', async ({ page }) => {
  await visit(page, '/dashboard')
  const data = await actionResponse(page,
    () => page.getByRole('combobox', { name: 'Filter analyses by status' }).selectOption('partial'),
    (r) => endpoint('/analyses')(r) && new URL(r.url()).searchParams.get('status') === 'partial')
  expect(data.analyses.length).toBeGreaterThan(0)
  expect(data.analyses.every((analysis: { status: string }) => analysis.status === 'partial')).toBe(true)
  await expect(page.locator('body')).toContainText('Saved analyses')
  const link = page.locator('a[href*="analysis=' + ids.native + '"]').first()
  await link.click()
  await expect(page).toHaveURL(new RegExp('analysis=' + ids.native))
})

for (const path of ['/dashboard', '/catalog', '/analyses?analysis=' + ids.native,
  '/api-analysis?analysis=' + ids.native, '/ingestion', '/evidence']) {
  test('mobile layout ' + path, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await visit(page, path)
    if (path.startsWith('/analyses?')) await expect(page.getByRole('tab', { name: 'Observations', exact: true })).toBeVisible()
    if (path.startsWith('/api-analysis?')) await expect(page.getByRole('tab', { name: 'Résumé', exact: true })).toBeVisible()
    if (path === '/catalog') await expect(page.getByRole('button', { name: 'Inspect source aqua', exact: true })).toBeVisible()
    await noPageOverflow(page)
  })
}
