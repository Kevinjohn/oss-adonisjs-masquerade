import { test } from '@japa/runner'
import { parseAuditHistoryFilters } from '../examples/native-session/app/services/audit_history_query.js'

test.group('audit history query filters', () => {
  test('rejects an invalid ISO date before it can reach query conversion', ({ assert }) => {
    assert.isNull(parseAuditHistoryFilters({ from: 'not-a-date', page: '1' }))
  })

  test('accepts ISO instants and a positive safe-integer page', ({ assert }) => {
    assert.deepEqual(
      parseAuditHistoryFilters({
        from: '2026-11-16T12:30:00-05:00',
        to: '2026-11-17T00:00:00Z',
        page: '3',
      }),
      {
        from: '2026-11-16T17:30:00.000Z',
        to: '2026-11-17T00:00:00.000Z',
        page: 3,
      }
    )
  })

  test('rejects a page outside the positive safe-integer range', ({ assert }) => {
    assert.isNull(parseAuditHistoryFilters({ page: '9007199254740992' }))
  })
})
