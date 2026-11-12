import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { analysisFixture, areaFixture, envelope } from '../src/services/test-fixtures'

const ids = { native: 'a3000000-0000-4000-8000-000000000001', current: '22222222-2222-4222-8222-222222222222' }

/** Controlled API responses make the layout regression independent of archive availability. */
test('visualization layout retains all chart marks while resizing and exports the replacement comparison', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const analysis = { ...analysisFixture, id: ids.native, status: 'ready', start_date: '2024-01-01', end_date_exclusive: '2026-01-01', job: null }
  const sourceIds = ['aqua', 'terra', 'snpp', 'noaa20', 'noaa21']
  const periods = Array.from({ length: 24 }, (_, i) => ({
    start: new Date(Date.UTC(2024, i, 1)).toISOString(), end_exclusive: new Date(Date.UTC(2024, i + 1, 1)).toISOString(),
    counts_by_source: sourceIds.map((source_id, index) => ({ source_id, count: String((i % 12 + 1) * (index + 1) + Math.floor(i / 12)), count_status: 'complete' })),
  }))
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let data: unknown
    if (path.endsWith('/analyses')) data = { analyses: [analysis], nextCursor: null }
    else if (path.endsWith('/calendar')) data = { analysis_id: ids.native, data_release_id: ids.current, resolution: 'month', periods, status: 'ready' }
    else if (path.includes('/analyses/')) data = analysis
    else if (path.includes('/areas/')) data = areaFixture
    else if (path.endsWith('/catalog')) data = { scope_key: 'layout_test', releases: [], sources: sourceIds.map((source_id) => ({ source_id, platform: source_id, instrument: 'test', product: 'test', collection: 'test', processing_stream: 'standard' })) }
    else data = { checks: { database: 'ready', redis: 'ready', catalogue: 'ready' } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope(data)) })
  })
  const response = await page.goto('/visualization?analysis=' + ids.native)
  expect(response?.status()).toBe(200)
  const comparison = page.getByRole('img', { name: 'Paired monthly source counts', exact: true })
  await expect(comparison).toBeVisible()
  const plots = page.locator('.lab-scroll > svg, .lab-matrix > svg')
  await expect(plots).toHaveCount(7)
  for (const width of [320, 390, 768, 1024, 1200, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => plots.evaluateAll((nodes) => nodes.every((node) => {
      const svg = node as SVGSVGElement
      return Math.abs(svg.getBoundingClientRect().width - svg.viewBox.baseVal.width) < 2
    }))).toBe(true)
    const clipped = await plots.evaluateAll((nodes) => nodes.flatMap((node) => {
      const svg = node as SVGSVGElement, r = svg.getBoundingClientRect(), parent = svg.parentElement!.getBoundingClientRect(), box = svg.getBBox(), v = svg.viewBox.baseVal
      return r.width > parent.width + 1 || r.height > parent.height + 1 || box.x < -1 || box.x + box.width > v.width + 1 || box.y < -1 || box.y + box.height > v.height + 1 ? [svg.getAttribute('aria-label')] : []
    }))
    expect(clipped, `No clipped chart at viewport ${width}px`).toEqual([])
    await expect(page.locator('[data-box-source]')).toHaveCount(5)
    for (const source of await page.locator('[data-box-source]').all()) await expect(source.locator('circle')).toHaveCount(24)
    await expect(comparison.locator('[data-paired-month]')).toHaveCount(12)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => comparison.evaluate((node) => Math.floor(node.getBoundingClientRect().width) - (node as SVGSVGElement).viewBox.baseVal.width)).toBe(0)
  await page.getByLabel('Source comparison year').selectOption('2024')
  await comparison.locator('[tabindex]').first().focus()
  await expect(page.getByRole('figure', { name: 'Monthly source comparison', exact: true }).locator('output')).toContainText('Jan 2024')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download SVG: Monthly source comparison', exact: true }).click()
  const file = await pending, svg = await readFile((await file.path())!, 'utf8')
  expect(svg).toContain('Monthly source comparison')
  expect(svg).not.toMatch(/NaN|Infinity/)
  expect(await page.evaluate((value) => new DOMParser().parseFromString(value, 'image/svg+xml').querySelector('parsererror')?.textContent ?? null, svg)).toBeNull()
  const artifact = await page.context().newPage()
  await artifact.goto('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))
  const exportedBounds = await artifact.locator('svg').first().evaluate((node) => {
    const svg = node as SVGSVGElement, box = svg.getBBox(), view = svg.viewBox.baseVal
    return { fits: box.x >= -1 && box.x + box.width <= view.width + 1 && box.y >= -1 && box.y + box.height <= view.height + 1, box: [box.x, box.y, box.width, box.height], view: [view.width, view.height], text: [...svg.querySelectorAll('text')].map((n) => ({ text: n.textContent, x: n.getBBox().x, width: n.getBBox().width })).filter((n) => n.x < -1 || n.x + n.width > view.width + 1) }
  })
  expect(exportedBounds.view[0], 'Export the chart, not the download icon').toBeGreaterThan(250)
  expect(exportedBounds.fits, 'The mobile SVG export retains all labels: ' + JSON.stringify(exportedBounds)).toBe(true)
  await artifact.close()
  expect(errors).toEqual([])
})
