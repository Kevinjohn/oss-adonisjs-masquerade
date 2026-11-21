import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Compile in an isolated NodeNext program, without the example's host augmentations or config.
const eventProbe = `
import type {} from '@kevinjohn/adonisjs-masquerade/masquerade_provider'
import emitter from '@adonisjs/core/services/emitter'
import type { EventsList } from '@adonisjs/core/types'
import type { ModeAccess, ObserverEvent, TransitionKind } from '@kevinjohn/adonisjs-masquerade/types'
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
type Started = Assert<Equal<EventsList['masquerade:started'], ObserverEvent>>
type Stopped = Assert<Equal<EventsList['masquerade:stopped'], ObserverEvent>>
type Expired = Assert<Equal<EventsList['masquerade:expired'], ObserverEvent>>
type Invalidated = Assert<Equal<EventsList['masquerade:invalidated'], ObserverEvent>>
${['started', 'stopped', 'expired', 'invalidated']
  .map(
    (name) => `
emitter.on('masquerade:${name}', (event) => {
  const typed: Assert<Equal<typeof event, ObserverEvent>> = true
  const id: string = event.id
  const actor: string = event.actorId
  const target: string | undefined = event.targetId
  const kind: TransitionKind = event.kind
  const access: ModeAccess | undefined = event.access
  const namespace: string = event.namespace
  const revision: number = event.revision
  // @ts-expect-error observers do not expose audit reasons
  event.reason
  return void [typed, id, actor, target, kind, access, namespace, revision]
})
`
  )
  .join('')}
`

/** Prove the installed provider's declaration is enough to subscribe to all four events. */
export async function verifyConsumerEventTypes(
  app: string,
  run: (args: string[]) => Promise<unknown>
) {
  const file = join(app, 'packed-event-probe.ts')
  await writeFile(file, eventProbe)
  try {
    await run([
      'exec',
      'tsc',
      '--strict',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--noEmit',
      '--skipLibCheck',
      file,
    ])
  } finally {
    await rm(file, { force: true })
  }
}
