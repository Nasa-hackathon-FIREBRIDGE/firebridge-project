import { test as base, expect, type Page, type Response } from '@playwright/test'

export const apiURL = 'http://127.0.0.1:3301/api/v1'
export const ids = {
  native: 'a3000000-0000-4000-8000-000000000001',
  prepared: '60000000-0000-4000-8000-000000000100',
  current: '22222222-2222-4222-8222-222222222222',
  previous: '11111111-1111-4111-8111-111111111111',
  area: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  subscription: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  run: 'f5000000-0000-4000-8000-000000000001',
}
export const testAdminToken = 'test-only-ingestion-admin-token-at-least-32-characters'

export const test = base.extend<{ applicationErrors: string[] }>({
  applicationErrors: [async ({ page }, use, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (response.url().startsWith(apiURL) && response.status() >= 500)
        errors.push(response.status() + ' ' + new URL(response.url()).pathname)
    })
    await use(errors)
    await expect(page.getByRole('heading', { name: 'This view couldn’t be displayed', exact: true }),
      'React error boundaries must not hide a render failure').toHaveCount(0)
    if (errors.length) await info.attach('application-errors', {
      body: JSON.stringify(errors), contentType: 'application/json',
    })
    expect(errors, 'No uncaught JavaScript exception or API 5xx response').toEqual([])
  }, { auto: true }],
})
export { expect }

export async function visit(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect(response?.status()).toBe(200)
  await expect(page.locator('h1').first()).toBeVisible()
}
export function endpoint(path: string, method = 'GET') {
  return (response: Response) => response.url().startsWith(apiURL + path) &&
    response.request().method() === method
}
export async function actionResponse(page: Page, action: () => Promise<unknown>,
  predicate: (response: Response) => boolean) {
  const pending = page.waitForResponse(predicate)
  await action()
  const response = await pending
  expect(response.ok(), response.url() + ': ' + response.status()).toBe(true)
  return (await response.json()).data
}
export async function noPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth, viewport: window.innerWidth,
  }))
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 2)
}
export async function operatorSession(page: Page) {
  await visit(page, '/ingestion')
  await page.locator('input[name="token"]').fill(testAdminToken)
  await page.getByRole('button', { name: 'Accéder à l’administration' }).click()
  await expect(page.getByRole('button', { name: /Fermer la session/ })).toBeVisible()
}
