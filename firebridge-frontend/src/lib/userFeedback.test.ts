import { describe, expect, it } from 'vitest'
import { ApiClientError } from './axios'
import { safeReference, UserInputError, userFeedback } from './userFeedback'

describe('Authored user-facing error communication', () => {
  it.each([400, 401, 403, 404, 409, 410, 422, 429, 500, 503])(
    'never forwards an arbitrary HTTP %i message or payload',
    (status) => {
      const secret = 'SQL at C:/private/server.ts password=do-not-display'
      const feedback = userFeedback(
        new ApiClientError(
          secret,
          'SERVER_ERROR',
          status,
          undefined,
          undefined,
          { secret },
          { message: secret },
        ),
        'analysis',
      )
      expect(JSON.stringify(feedback)).not.toContain(secret)
      expect(feedback.title).toBeTruthy()
      expect(feedback.message).toBeTruthy()
    },
  )
  it('distinguishes uncertain writes from safe read recovery', () => {
    const offline = new ApiClientError('raw network detail', 'NETWORK_ERROR')
    expect(userFeedback(offline, 'analysis', 'read').retryable).toBe(true)
    const write = userFeedback(offline, 'analysis', 'write')
    expect(write.retryable).toBe(false)
    expect(write.message).toContain('may have received the request')
    expect(write.message).not.toContain('preserved')
  })
  it('keeps frontend validation actionable without trusting arbitrary Error messages', () => {
    expect(userFeedback(new UserInputError('Close the polygon ring.', 'geometry')).message).toBe(
      'Close the polygon ring.',
    )
    expect(userFeedback(new Error('sensitive internal path')).message).not.toContain(
      'sensitive internal path',
    )
  })
  it('keeps oversized geometry and absent release guidance specific', () => {
    expect(
      userFeedback(
        new ApiClientError(
          'Polygon surface area (12000 km²) exceeds the maximum allowed (10000 km²).',
          'VALIDATION_ERROR',
          400,
        ),
      ).message,
    ).toContain('12,000 km²')
    expect(
      userFeedback(new ApiClientError('backend details', 'NO_COMPATIBLE_RELEASE', 409)).title,
    ).toBe('Satellite data is unavailable for these dates.')
  })
  it('only exposes short, restricted support references', () => {
    expect(safeReference('request-123:abc')).toBe('request-123:abc')
    expect(safeReference('https://private/path?token=secret')).toBeUndefined()
    expect(safeReference('a'.repeat(101))).toBeUndefined()
  })
  it('explains the historical window limit without displaying arbitrary server messages', () => {
    const feedback = userFeedback(
      new ApiClientError('private server detail', 'HISTORICAL_WINDOW_TOO_LARGE', 400),
      'analysis',
      'write',
    )
    expect(feedback.title).toBe('The historical date range is too long')
    expect(feedback.message).toContain('10,980 days (about 30 years)')
    expect(feedback.message).toContain('split it into separate analyses')
    expect(feedback.message).not.toContain('private server detail')
    expect(feedback.retryable).toBe(false)
  })
})
