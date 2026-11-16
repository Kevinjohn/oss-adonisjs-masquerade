import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { currentAccountForAuditIdentity } from '#services/audit_history_identity'
import { nativeAdapter } from '#config/masquerade'

export default class MasqueradeHistoryController {
  async index({ request, view, bouncer }: HttpContext) {
    await bouncer.authorize('viewMasqueradeHistory')

    const { from, to, page = 1 } = request.qs()

    const events = await db
      .from('masquerade_events')
      .where('authority_namespace', nativeAdapter.authority.namespace)
      .if(from, (query) => query.where('at', '>=', new Date(from).toISOString()))
      .if(to, (query) => query.where('at', '<', new Date(to).toISOString()))
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
      .paginate(Number(page) || 1, 50)

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
