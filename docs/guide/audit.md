# Audit business work and observe transitions

The package's durable control audit records committed starts, stops, expiry/invalidations, and
admitted control denials/no-ops. Keep that ledger distinct from the host's business audit, which
should describe the actual customer operation and outcome. After the customer's authorization
check and successful business write, resolve the safe identity projection and attach it to the host
audit record. Include it in the host transaction when that audit must commit atomically with the
business change:

```ts
import { masqueradeAuditFields } from '@kevinjohn/adonisjs-masquerade/http'

await businessAudit.record({
  action: 'customer.preference.updated',
  outcome: 'success',
  ...(await masqueradeAuditFields(ctx)),
})
```

`masqueradeAuditFields(ctx)` always returns the same keys: `actorId`, `actorIncarnation`,
`effectiveId`, `effectiveIncarnation`, `isMasquerading`, `modeId` and `access`. While idle, the
effective identity is the actor and `modeId` and `access` are `null`, so one audit table shape
covers every request. `businessAudit.record` is the host's own audit writer. Do not infer the actor
from `ctx.auth.user` on an effective route or persist model objects, stamps, raw context tokens, or
request bodies as identity metadata.

## Review masquerade history

The package's control ledger is the `masquerade_events` table created by the generated migration.
The package ships no history page; a host can list the ledger with its own query and its own admin
authorization. Keep the route behind the raw `web` guard so an active mode never changes who is
reviewing:

```ts
// app/controllers/masquerade_history_controller.ts
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'

export default class MasqueradeHistoryController {
  async index({ request, view, bouncer }: HttpContext) {
    await bouncer.authorize('viewMasqueradeHistory')
    const { actorId, targetId, from, to, page = 1 } = request.qs()
    const events = await db
      .from('masquerade_events')
      .where('authority_namespace', 'my_app')
      .if(actorId, (query) => query.where('actor_id', String(actorId)))
      .if(targetId, (query) => query.where('target_id', String(targetId)))
      // `at` is a UTC ISO 8601 string, so string comparison orders by time.
      .if(from, (query) => query.where('at', '>=', new Date(from).toISOString()))
      .if(to, (query) => query.where('at', '<', new Date(to).toISOString()))
      .select('at', 'kind', 'outcome_code', 'actor_id', 'target_id', 'access', 'reason')
      .orderBy([
        { column: 'at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .paginate(Number(page) || 1, 50)
    return view.render('admin/masquerade_history', { events })
  }
}
```

```ts
// start/routes.ts
router
  .get('/admin/masquerade-history', [
    () => import('#controllers/masquerade_history_controller'),
    'index',
  ])
  .as('admin.masquerade_history')
  .use(middleware.auth({ guards: ['web'] }))
```

Each row is one control event: `kind` is `started`, `stopped`, `expired`, `invalidated`,
`start_denied`, `stop_denied` or `control_noop`, and `outcome_code` says why (for example
`edit_denied` for an invalidation). `reason` is set only on `started` rows, and is null when the
host's reason policy is optional and none was given. Join `actor_id` and `target_id` to the host's
users table to show names; the ledger stores IDs only. The ledger keeps events for the configured
[retention](operations.md#event-retention-and-store-scope); choose `retention: { days: n }` or
`'host-managed'` to match the host's compliance period.

For notifications or cache invalidation, a host may also subscribe to transition events through
AdonisJS's emitter:

<!-- host-recipe:transition-observer -->

```ts
import type { ObserverEvent } from '@kevinjohn/adonisjs-masquerade/types'
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

declare module '@adonisjs/core/types' {
  interface EventsList {
    'masquerade:started': ObserverEvent
    'masquerade:stopped': ObserverEvent
    'masquerade:expired': ObserverEvent
    'masquerade:invalidated': ObserverEvent
  }
}

emitter.on('masquerade:started', (event) => {
  logger.info({ action: 'support_mode_started', eventId: event.id })
})
```

Observers run after commit and are best effort. Their event kind is one of the four transitions and
omits the reason; observers do not report denied starts/stops or no-op controls. Do not use observer delivery as the durable control ledger or the
host's business audit. The public payload type is added to the host's Adonis event list in the
listener module so TypeScript can type these event names. [Alert on masquerade
activity](alerts.md) has listener recipes for chat alerts and a log sink.
