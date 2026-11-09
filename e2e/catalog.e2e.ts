import { test, expect, visit, endpoint, actionResponse, noPageOverflow, ids } from './fixtures'

test('catalogue search, source inspection and local table scrolling', async ({ page }) => {
  await visit(page, '/catalog')
  await expect(page.getByText('phase1_test', { exact: true }).first()).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search catalogue sources' }).fill('Aqua')
  await expect(page.getByRole('button', { name: 'Inspect source aqua', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Inspect source terra', exact: true })).toHaveCount(0)
  const source = await actionResponse(page,
    () => page.getByRole('button', { name: 'Inspect source aqua', exact: true }).click(),
    endpoint('/sources/aqua/availability'))
  expect(source.source_id).toBe('aqua')
  const panel = page.getByRole('complementary', { name: 'Selected catalogue source' })
  await expect(panel.getByRole('heading', { name: 'Disponibilité et imports de la source' })).toBeVisible()
  await expect(panel).toContainText('INGESTION_GAPS')
  await expect(panel).toContainText('Inconnu / non disponible')
  await noPageOverflow(page)
  await page.setViewportSize({ width: 960, height: 900 })
  await noPageOverflow(page)
  await panel.getByRole('button', { name: 'Close source details' }).click()
  await expect(panel).toHaveCount(0)
})

test('release partition pagination, previous page and asset membership', async ({ page }) => {
  await visit(page, '/catalog')
  const panel = page.locator('#catalogue-releases')
  await panel.locator('input[name="limit"]').fill('1')
  const first = await actionResponse(page,
    () => panel.getByRole('button', { name: 'Appliquer les filtres' }).click(),
    (r) => endpoint('/releases/')(r) && new URL(r.url()).searchParams.get('limit') === '1')
  expect(first.membership.items).toHaveLength(1)
  expect(first.membership.next_cursor).toBeTruthy()
  const second = await actionResponse(page,
    () => panel.getByRole('button', { name: 'Page suivante' }).click(),
    (r) => endpoint('/releases/')(r) && new URL(r.url()).searchParams.has('cursor'))
  expect(second.membership.items).not.toEqual(first.membership.items)
  await panel.getByRole('button', { name: 'Page précédente' }).click()
  await expect(panel.getByRole('button', { name: 'Page précédente' })).toBeDisabled()
  await panel.locator('select[name="membership"]').selectOption('assets')
  const assets = await actionResponse(page,
    () => panel.getByRole('button', { name: 'Appliquer les filtres' }).click(),
    (r) => endpoint('/releases/')(r) && new URL(r.url()).searchParams.get('membership') === 'assets')
  expect(assets.membership.kind).toBe('assets')
  await expect(panel.getByText(assets.membership.items[0].asset_id, { exact: true }).first()).toBeVisible()
})

test('release reference detects a newer version and can select the current baseline', async ({ page }) => {
  await visit(page, '/catalog')
  await page.locator('input[name="baseline"]').fill(ids.previous)
  const updates = await actionResponse(page,
    () => page.getByRole('button', { name: 'Comparer les versions' }).click(),
    (r) => endpoint('/updates')(r) && new URL(r.url()).searchParams.get('after_release_id') === ids.previous)
  expect(updates.has_updates).toBe(true)
  await expect(page.locator('#catalogue-updates')).toContainText('Une nouvelle version est disponible')
  await page.getByRole('button', { name: 'Utiliser cette version comme référence' }).click()
  await expect(page.locator('input[name="baseline"]')).toHaveValue(ids.current)
  await expect(page.locator('#catalogue-updates')).toContainText('Aucune nouvelle version signalée')
})

test('public availability selector reads the selected source without an operator token', async ({ page }) => {
  await visit(page, '/catalog')
  const result = await actionResponse(page,
    () => page.locator('#catalogue-availability select').selectOption('terra'),
    endpoint('/sources/terra/availability'))
  expect(result.scope_key).toBe('phase1_test')
  expect(result.observation_coverage).toBeNull()
  await expect(page.locator('#catalogue-availability')).toContainText('gaps_present')
})
