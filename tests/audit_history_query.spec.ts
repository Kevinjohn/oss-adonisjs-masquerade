import { test } from '@japa/runner'

interface AuditHistoryFilters {
  from?: string
  to?: string
  page: number
}

interface QueryModule {
  parseAuditHistoryFilters(input: {
    from?: unknown
    to?: unknown
    page?: unknown
  }): AuditHistoryFilters | null
}

async function parseAuditHistoryFilters(input: {
  from?: unknown
  to?: unknown
  page?: unknown
}): Promise<AuditHistoryFilters | null> {
  const module = (await import(
    new URL('../examples/native-session/app/services/audit_history_query.ts', import.meta.url).href
  )) as QueryModule
  return module.parseAuditHistoryFilters(input)
}

test.group('audit history query filters', () => {
  test('rejects an invalid ISO date before it can reach query conversion', async ({ assert }) => {
    assert.isNull(await parseAuditHistoryFilters({ from: 'not-a-date', page: '1' }))
  })

  test('accepts ISO instants and a positive safe-integer page', async ({ assert }) => {
    assert.deepEqual(
      await parseAuditHistoryFilters({
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

  test('rejects a page outside the positive safe-integer range', async ({ assert }) => {
    assert.isNull(await parseAuditHistoryFilters({ page: '9007199254740992' }))
  })

  test('rejects invalid upper dates and malformed page values', async ({ assert }) => {
    for (const input of [
      { to: 'not-a-date' },
      { page: '0' },
      { page: '-1' },
      { page: '1.5' },
      { page: ['1', '2'] },
    ]) {
      assert.isNull(await parseAuditHistoryFilters(input))
    }
  })
})
