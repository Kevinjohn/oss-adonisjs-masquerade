import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { getCommand, getMetaData } from '../commands/main.js'
import { fixture } from './helpers/core.js'

test.group('masquerade:prune Ace command', () => {
  test('is discoverable through the package command loader', async ({ assert }) => {
    const metadata = await getMetaData()
    const command = await getCommand(metadata[0]!)
    const { default: PruneCommand } = await import('../commands/prune.js')
    assert.equal(metadata[0]?.commandName, 'masquerade:prune')
    assert.equal(metadata[0]?.flags.find((flag) => flag.flagName === 'batch-size')?.type, 'number')
    assert.equal(command, PruneCommand)
  })

  test('executes through Ace with the native application services', async ({ assert }) => {
    const f = fixture()
    const previousNodeEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    const service = await f.create()
    await f.start(service)
    const ignitor = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .merge({
        config: { masquerade: f.config },
        rcFileContents: {
          commands: [() => import('../commands/main.js')],
          providers: [() => import('@adonisjs/core/providers/app_provider')],
        },
      })
      .create(new URL('../', import.meta.url))
    let resolveListenerError!: (error: unknown) => void
    const listenerRejected = new Promise<unknown>((resolve) => {
      resolveListenerError = resolve
    })
    try {
      await ignitor
        .ace()
        .configure(async (app) => {
          await app.boot()
          const emitter = (await app.container.make('emitter')) as unknown as {
            on(event: string, listener: () => void): void
            onError(callback: (event: string, error: unknown, data: unknown) => void): void
          }
          emitter.onError((_event, error) => resolveListenerError(error))
          emitter.on('masquerade:expired', () => {
            throw new Error('expiry listener rejected')
          })
        })
        .handle(['masquerade:prune', '--batch-size=1'])
    } finally {
      if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnvironment
    }
    const row = await f.store.read(f.owner)
    assert.equal(row?.state, 'idle')
    const listenerError = await listenerRejected
    assert.equal((listenerError as Error).message, 'expiry listener rejected')
    assert.equal(f.store.events.find((event) => event.kind === 'expired')?.outcomeCode, 'expired')
  })
})
