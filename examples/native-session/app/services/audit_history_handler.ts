import type { CurrentAccountSnapshot } from './audit_history_identity.js'
import { currentAccountForAuditIdentity } from './audit_history_identity.js'
import { parseAuditHistoryFilters, type AuditHistoryFilters } from './audit_history_query.js'

export interface AuditHistoryEvent {
  actor_id: string
  actor_incarnation: string
  target_id: string | null
  target_incarnation: string | null
}

export interface AuditHistoryContext {
  request: { qs(): Record<string, unknown> }
  response: { badRequest(): unknown }
  view: { render(template: string, data: unknown): unknown }
  bouncer: { authorize(ability: string): Promise<unknown> }
}

export function createAuditHistoryIndex<User, Event extends AuditHistoryEvent>(options: {
  query(filters: AuditHistoryFilters): Promise<{ metadata: object; rows: Event[] }>
  inspectAccount(id: string): Promise<CurrentAccountSnapshot<User> | null>
  displayName(user: User): string | null
}) {
  return async function index(ctx: AuditHistoryContext) {
    await ctx.bouncer.authorize('viewMasqueradeHistory')

    const filters = parseAuditHistoryFilters(ctx.request.qs())
    if (filters === null) return ctx.response.badRequest()

    const { metadata, rows } = await options.query(filters)
    const data = await Promise.all(
      rows.map(async (event) => {
        const [actor, target] = await Promise.all([
          currentAccountForAuditIdentity(event.actor_id, event.actor_incarnation, (id) =>
            options.inspectAccount(id)
          ),
          currentAccountForAuditIdentity(event.target_id, event.target_incarnation, (id) =>
            options.inspectAccount(id)
          ),
        ])

        return {
          ...event,
          actorName: actor ? (options.displayName(actor) ?? event.actor_id) : event.actor_id,
          targetName: target ? (options.displayName(target) ?? event.target_id) : event.target_id,
        }
      })
    )

    return ctx.view.render('admin/masquerade_history', { events: { ...metadata, data } })
  }
}
