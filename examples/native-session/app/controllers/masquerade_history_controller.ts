import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import { nativeAdapter } from '#config/masquerade'
import { createAuditHistoryIndex, type AuditHistoryEvent } from '#services/audit_history_handler'

type MasqueradeHistoryContext = Omit<HttpContext, 'bouncer'> & {
  bouncer: { authorize(ability: string): Promise<unknown> }
}

const indexHistory = createAuditHistoryIndex<User, AuditHistoryEvent & Record<string, unknown>>({
  async query(filters) {
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

    return { metadata: events.toJSON().meta, rows: events.all() }
  },
  inspectAccount: (id) => nativeAdapter.authority.inspectAccount(id),
  displayName: (user) => user.fullName,
})

export default class MasqueradeHistoryController {
  index(ctx: MasqueradeHistoryContext) {
    return indexHistory(ctx)
  }
}
