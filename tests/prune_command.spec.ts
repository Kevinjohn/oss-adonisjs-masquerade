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

  test('reports confirmed partial progress and fails after a later read error', async ({
    assert,
  }) => {
    const f = fixture()
    f.config.retention = { days: 1 }
    await f.start(await f.create())
    f.state.now += 2 * 86_400_000
    const candidate = (await f.store.read(f.owner))!
    const read = f.store.read.bind(f.store)
    f.store.expiredBatch = async () => [candidate, candidate]
    let reads = 0
    f.store.read = async (owner) => {
      if (++reads === 2) throw new Error('later read failed')
      return read(owner)
    }
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
    const output: string[] = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    const originalErrorWrite = process.stderr.write.bind(process.stderr)
    const originalExitCode = process.exitCode
    const previousNodeEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      output.push(String(chunk))
      return originalWrite(chunk, ...(args as []))
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      output.push(String(chunk))
      return originalErrorWrite(chunk, ...(args as []))
    }) as typeof process.stderr.write
    try {
      await ignitor.ace().handle(['masquerade:prune', '--batch-size=2'])
      assert.equal(process.exitCode, 1)
    } finally {
      process.stdout.write = originalWrite
      process.stderr.write = originalErrorWrite
      process.exitCode = originalExitCode
      if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnvironment
    }
    const text = output.join('')
    assert.include(text, 'Prune failed during read')
    assert.include(text, 'confirmed expired 1 mode(s); confirmed deleted 1 event(s)')
    const persisted = await read(f.owner)
    assert.equal(persisted?.state, 'idle')
    assert.deepEqual(
      f.store.events.map((event) => event.kind),
      ['expired']
    )
    f.store.read = read
    const { pruneMasquerade } = await import('../src/prune.js')
    assert.deepEqual(await pruneMasquerade(f.config, f.dependencies), {
      expired: 0,
      eventsDeleted: 0,
    })
  })
})
