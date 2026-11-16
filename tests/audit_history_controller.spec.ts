import { test } from '@japa/runner'

interface AuditHistoryEvent {
  actor_id: string
  actor_incarnation: string
  target_id: string | null
  target_incarnation: string | null
}

interface AuditHistoryContext {
  request: { qs(): Record<string, unknown> }
  response: { badRequest(): unknown }
  view: { render(template: string, data: unknown): unknown }
  bouncer: { authorize(ability: string): Promise<unknown> }
}

interface HandlerModule {
  createAuditHistoryIndex<
    User,
    Event extends AuditHistoryEvent & Record<string, unknown>,
  >(options: {
    query(filters: { from?: string; to?: string; page: number }): Promise<{
      metadata: object
      rows: Event[]
    }>
    inspectAccount(id: string): Promise<{
      subject: { id: string; incarnation: string; user: User }
    } | null>
    displayName(user: User): string | null
  }): (ctx: AuditHistoryContext) => Promise<unknown>
}

async function createAuditHistoryIndex<
  User,
  Event extends AuditHistoryEvent & Record<string, unknown>,
>(options: {
  query(filters: { from?: string; to?: string; page: number }): Promise<{
    metadata: object
    rows: Event[]
  }>
  inspectAccount(id: string): Promise<{
    subject: { id: string; incarnation: string; user: User }
  } | null>
  displayName(user: User): string | null
}) {
  const module = (await import(
    new URL('../examples/native-session/app/services/audit_history_handler.ts', import.meta.url)
      .href
  )) as HandlerModule
  return module.createAuditHistoryIndex(options)
}

test.group('audit history controller boundary', () => {
  test('authorizes before rejecting invalid filters without querying', async ({ assert }) => {
    const order: string[] = []
    const badRequest = { status: 400 }
    const index = await createAuditHistoryIndex({
      query: async () => {
        order.push('query')
        throw new Error('query must not run')
      },
      inspectAccount: async () => null,
      displayName: () => null,
    })

    const result = await index({
      request: { qs: () => ({ from: 'not-a-date', page: '1' }) },
      response: {
        badRequest: () => {
          order.push('badRequest')
          return badRequest
        },
      },
      view: {
        render: () => {
          throw new Error('view must not render')
        },
      },
      bouncer: {
        authorize: async () => {
          order.push('authorize')
        },
      },
    } satisfies AuditHistoryContext)

    assert.deepEqual(order, ['authorize', 'badRequest'])
    assert.equal(result, badRequest)
  })

  test('queries valid filters and labels only verified current identities', async ({ assert }) => {
    const order: string[] = []
    let queriedFilters: unknown
    const inspected: string[] = []
    const index = await createAuditHistoryIndex({
      query: async (filters) => {
        order.push('query')
        queriedFilters = filters
        return {
          metadata: { currentPage: filters.page },
          rows: [
            {
              at: '2026-11-16T17:30:00.000Z',
              actor_id: 'operator-1',
              actor_incarnation: 'operator-v1',
              target_id: 'customer-2',
              target_incarnation: 'customer-v1',
            },
            {
              at: '2026-11-16T17:30:00.000Z',
              actor_id: 'operator-1',
              actor_incarnation: 'operator-v1',
              target_id: 'deleted-3',
              target_incarnation: null,
            },
          ],
        }
      },
      inspectAccount: async (id) => {
        inspected.push(id)
        if (id === 'operator-1')
          return {
            subject: {
              id,
              incarnation: 'operator-v1',
              user: { name: 'Operator Current' },
            },
          }
        if (id === 'customer-2')
          return {
            subject: {
              id,
              incarnation: 'customer-v2',
              user: { name: 'Replacement Customer' },
            },
          }
        return null
      },
      displayName: (user) => user.name,
    })
    let rendered: unknown
    const renderResult = { rendered: true }

    const result = await index({
      request: {
        qs: () => ({ from: '2026-11-16T12:30:00-05:00', page: '2' }),
      },
      response: {
        badRequest: () => {
          throw new Error('valid filters must not be rejected')
        },
      },
      view: {
        render: (_template, data) => {
          order.push('render')
          rendered = data
          return renderResult
        },
      },
      bouncer: {
        authorize: async () => {
          order.push('authorize')
        },
      },
    } satisfies AuditHistoryContext)

    assert.equal(result, renderResult)
    assert.deepEqual(order, ['authorize', 'query', 'render'])
    assert.deepEqual(queriedFilters, {
      from: '2026-11-16T17:30:00.000Z',
      to: undefined,
      page: 2,
    })
    assert.deepEqual(inspected, ['operator-1', 'customer-2', 'operator-1'])
    assert.deepEqual(rendered, {
      events: {
        currentPage: 2,
        data: [
          {
            at: '2026-11-16T17:30:00.000Z',
            actor_id: 'operator-1',
            actor_incarnation: 'operator-v1',
            target_id: 'customer-2',
            target_incarnation: 'customer-v1',
            actorName: 'Operator Current',
            targetName: 'customer-2',
          },
          {
            at: '2026-11-16T17:30:00.000Z',
            actor_id: 'operator-1',
            actor_incarnation: 'operator-v1',
            target_id: 'deleted-3',
            target_incarnation: null,
            actorName: 'Operator Current',
            targetName: 'deleted-3',
          },
        ],
      },
    })
  })
})
