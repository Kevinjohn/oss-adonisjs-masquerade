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
