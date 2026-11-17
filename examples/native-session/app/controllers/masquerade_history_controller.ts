import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { parseAuditHistoryFilters } from '#services/audit_history_query'
import { currentAccountForAuditIdentity } from '#services/audit_history_identity'
import { nativeAdapter } from '#config/masquerade'

type MasqueradeHistoryContext = Omit<HttpContext, 'bouncer'> & {
  bouncer: { authorize(ability: string): Promise<unknown> }
}

export default class MasqueradeHistoryController {
  async index({ request, response, view, bouncer }: MasqueradeHistoryContext) {
    await bouncer.authorize('viewMasqueradeHistory')

    const filters = parseAuditHistoryFilters(request.qs())
    if (filters === null) return response.badRequest()

    const events = await db
      .from('masquerade_events')
      .where('authority_namespace', nativeAdapter.authority.namespace)
      .if(filters.from, (query) => query.where('at', '>=', filters.from!))
      .if(filters.to, (query) => query.where('at', '<', filters.to!))
      .select(
        'at',
        'kind',
        'outcome_code',
        'actor_id',
        'actor_incarnation',
        'target_id',
        'target_incarnation',
        'access',
        'reason'
      )
      .orderBy([
        { column: 'at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .paginate(filters.page, 50)

    const rows = await Promise.all(
      events.all().map(async (event) => {
        const [actor, target] = await Promise.all([
          currentAccountForAuditIdentity(event.actor_id, event.actor_incarnation, (id) =>
            nativeAdapter.authority.inspectAccount(id)
          ),
          currentAccountForAuditIdentity(event.target_id, event.target_incarnation, (id) =>
            nativeAdapter.authority.inspectAccount(id)
          ),
        ])

        return {
          ...event,
          actorName: actor?.fullName ?? event.actor_id,
          targetName: target?.fullName ?? event.target_id,
        }
      })
    )

    return view.render('admin/masquerade_history', { events: { ...events.toJSON(), data: rows } })
  }
}
