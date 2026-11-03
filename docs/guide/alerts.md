# Alert on masquerade activity

After each committed transition the package emits one AdonisJS event:
`masquerade:started`, `masquerade:stopped`, `masquerade:expired` or `masquerade:invalidated`. Each
listener receives an `ObserverEvent`:

| Field                           | Meaning                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `id`                            | Ledger event ID, the same as the `masquerade_events` row.      |
| `kind`                          | `started`, `stopped`, `expired` or `invalidated`.              |
| `outcomeCode`                   | Why it happened, for example `edit_denied` on an invalidation. |
| `namespace`                     | The authority namespace.                                       |
| `actorId`, `actorIncarnation`   | The operator.                                                  |
| `targetId`, `targetIncarnation` | The customer.                                                  |
| `modeId`, `access`              | The mode and its access level, `view` or `edit`.               |
| `at`, `revision`                | UTC ISO 8601 time and the owner revision after the transition. |

The event never carries the start reason. Denied starts and stops and no-op controls do not emit
events; the ledger records the admitted ones.

## Post alerts and log transitions

The listener module below posts `started` and `invalidated` events to a chat webhook that accepts
`{ "text": "..." }` JSON, such as a Slack or Mattermost incoming webhook. It also writes every
transition to a child logger with a fixed set of fields, so a log transport can route the
`masquerade` channel to its own sink. The package already logs each event at `info` on the app
logger; the child logger is for a sink that should see these fields and nothing else.

Add the webhook URL to `start/env.ts`:

```ts
MASQUERADE_ALERT_WEBHOOK_URL: Env.schema.string.optional({ format: 'url', tld: false }),
```

Save the module as `start/masquerade_alerts.ts` and add `() => import('#start/masquerade_alerts')`
to `preloads` in `adonisrc.ts`. The same file type-checks in the native-session example.

<!-- host-recipe:masquerade-alerts -->

```ts
import type { ObserverEvent } from '@kevinjohn/adonisjs-masquerade/types'
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'

declare module '@adonisjs/core/types' {
  interface EventsList {
    'masquerade:started': ObserverEvent
    'masquerade:stopped': ObserverEvent
    'masquerade:expired': ObserverEvent
    'masquerade:invalidated': ObserverEvent
  }
}

const webhookUrl = env.get('MASQUERADE_ALERT_WEBHOOK_URL')

function alertText(event: ObserverEvent): string {
  const access = event.access ? ` (${event.access})` : ''
  return event.kind === 'started'
    ? `Operator ${event.actorId} started masquerading as ${event.targetId}${access}.`
    : `Masquerade by operator ${event.actorId} as ${event.targetId} was ended: ${event.outcomeCode}.`
}

async function postAlert(event: ObserverEvent): Promise<void> {
  if (!webhookUrl) return
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: alertText(event) }),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`Masquerade alert webhook returned ${response.status}`)
}

emitter.on('masquerade:started', postAlert)
emitter.on('masquerade:invalidated', postAlert)

const audit = logger.child({ channel: 'masquerade' })

function logTransition(event: ObserverEvent): void {
  audit.info(
    {
      eventId: event.id,
      kind: event.kind,
      outcomeCode: event.outcomeCode,
      namespace: event.namespace,
      actorId: event.actorId,
      targetId: event.targetId,
      modeId: event.modeId,
      access: event.access,
      at: event.at,
    },
    'masquerade transition'
  )
}

emitter.on('masquerade:started', logTransition)
emitter.on('masquerade:stopped', logTransition)
emitter.on('masquerade:expired', logTransition)
emitter.on('masquerade:invalidated', logTransition)
```

## Keep listeners short

- The package does not await the emitter, so a slow listener does not delay the control response.
  It still runs in the web process: keep each listener to one bounded call, with a timeout like the
  `AbortSignal.timeout` above.
- For retries, batching or slow sinks, push the event onto the host's queue in the listener and do
  the delivery in a job.
- A listener that throws or rejects goes to the emitter's `onError` handler when the host registers
  one. Otherwise the package logs `E_MASQUERADE_OBSERVER_FAILED`. The transition is already
  committed either way.

## Events are after-commit only

- A listener runs only after the store has committed the transition, so it never reports a mode
  that did not happen.
- Delivery is best effort. A process that stops between the commit and the listener loses the
  event, and a webhook outage loses the alert. Use the `masquerade_events` ledger, described in
  [audit and history](audit.md#review-masquerade-history), when every transition must be counted.
- Read the ledger or the service for current state. An alert can arrive after the mode it describes
  has already ended.
