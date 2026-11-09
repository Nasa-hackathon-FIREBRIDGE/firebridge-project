import { expect, it } from 'vitest'
import { externalReportUrl } from './format'

it('opens only absolute HTTP report links without embedded credentials', () => {
  expect(externalReportUrl('https://example.org/report')).toBe('https://example.org/report')
  for (const invalid of [null, '/relative/report', 'javascript:alert(1)', 'data:text/html,report', 'https://user:password@example.org/report']) {
    expect(externalReportUrl(invalid)).toBeNull()
  }
})
