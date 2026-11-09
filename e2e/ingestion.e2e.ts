import { test, expect, visit, operatorSession, actionResponse, endpoint, testAdminToken, ids } from './fixtures'

test('rejects an invalid operator token without exposing protected records', async ({ page }) => {
  await visit(page, '/ingestion')
  await page.locator('input[name="token"]').fill('invalid-test-only-token')
  await page.getByRole('button', { name: 'Accéder à l’administration' }).click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page.locator('#ingestion-subscriptions')).not.toContainText(ids.subscription)
})

test('operator reads subscriptions, paginates gaps, inspects a redacted run and clears the session', async ({ page }) => {
  await operatorSession(page)
  const subscriptions = page.locator('#ingestion-subscriptions')
  await expect(subscriptions).toContainText(ids.subscription)
  const gaps = page.locator('#ingestion-gaps')
  await gaps.locator('input[name="limit"]').fill('1')
  const first = await actionResponse(page,
    () => gaps.getByRole('button', { name: 'Appliquer les filtres' }).click(),
    (r) => endpoint('/admin/ingestion/gaps')(r) && new URL(r.url()).searchParams.get('limit') === '1')
  expect(first.gaps).toHaveLength(1)
  const next = await actionResponse(page,
    () => gaps.getByRole('button', { name: 'Page suivante' }).click(),
    (r) => endpoint('/admin/ingestion/gaps')(r) && new URL(r.url()).searchParams.has('cursor'))
  expect(next.gaps[0].id).not.toBe(first.gaps[0].id)
  const runPanel = page.locator('#ingestion-run')
  await runPanel.locator('input[name="run"]').fill(ids.run)
  const run = await actionResponse(page,
    () => runPanel.getByRole('button', { name: 'Inspecter', exact: true }).click(),
    endpoint('/admin/ingestion/runs/' + ids.run))
  expect(run.successful_empty).toBe(true)
  expect(JSON.stringify(run)).not.toContain('Bearer secret')
  expect(JSON.stringify(run)).not.toContain('private/MAP_KEY/token')
  await expect(runPanel).toContainText(ids.run)
  const saved = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(saved).not.toContain(testAdminToken)
  await page.getByRole('button', { name: /Fermer la session/ }).click()
  await expect(page.locator('input[name="token"]')).toBeVisible()
  await expect(page.locator('#ingestion-subscriptions')).toHaveCount(0)
})

test('backfill validates its interval then creates and follows a bounded import plan', async ({ page }) => {
  await operatorSession(page)
  const panel = page.locator('#ingestion-backfill')
  const values = { feed: 'modis', area: ids.area, scope: 'phase1_test', start: '2024-01-20T00:00:00Z',
    end: '2024-01-17T00:00:00Z', sources: 'terra,aqua', products: 'MCD14ML', collection: '6.1' }
  for (const [name, value] of Object.entries(values)) await panel.locator('input[name="' + name + '"]').fill(value)
  let mutations = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/admin/ingestion/backfills')) mutations++
  })
  await panel.getByRole('button', { name: 'Planifier l’import', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  expect(mutations).toBe(0)
  await panel.locator('input[name="start"]').fill('2024-01-17T00:00:00Z')
  await panel.locator('input[name="end"]').fill('2024-01-20T00:00:00Z')
  const plan = await actionResponse(page,
    () => panel.getByRole('button', { name: 'Planifier l’import', exact: true }).click(),
    endpoint('/admin/ingestion/backfills', 'POST'))
  expect(plan.execution_support).toBe('planning_only')
  expect(plan.estimated_bytes).toBeNull()
  await expect(panel).toContainText(plan.job_id)
  await expect(panel).toContainText('awaiting_fetch_executor', { timeout: 20_000 })
  await expect(panel).toContainText('Plan prêt, en attente d’un exécuteur')
})

test('subscription action fills refresh parameters before an explicit repair request', async ({ page }) => {
  await operatorSession(page)
  await page.locator('#ingestion-subscriptions').getByRole('row').filter({ hasText: ids.subscription })
    .getByRole('button', { name: 'Préparer l’actualisation' }).click()
  const panel = page.locator('#ingestion-refresh')
  await expect(panel.locator('input[name="subscription"]')).toHaveValue(ids.subscription)
  await panel.locator('select[name="mode"]').selectOption('repair')
  await panel.locator('select[name="reason"]').selectOption('gap_repair')
  await panel.locator('input[name="start"]').fill('2024-01-18T00:00:00Z')
  await panel.locator('input[name="end"]').fill('2024-01-19T00:00:00Z')
  const plan = await actionResponse(page,
    () => panel.getByRole('button', { name: 'Planifier l’actualisation', exact: true }).click(),
    endpoint('/admin/ingestion/subscriptions/' + ids.subscription + '/refresh', 'POST'))
  expect(plan.execution_support).toBe('planning_only')
  await expect(panel).toContainText(plan.job_id)
  await expect(panel).toContainText('awaiting_fetch_executor', { timeout: 20_000 })
})
