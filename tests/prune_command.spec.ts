import { errors } from '../index.js'
import { Kernel } from '@adonisjs/core/ace'
import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { getCommand, getMetaData } from '../commands/main.js'
import { pruneMasquerade } from '../src/prune.js'
import { fixture } from './helpers/core.js'

function createIgnitor(config: ReturnType<typeof fixture>['config']) {
  return new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      config: { masquerade: config },
      rcFileContents: {
        commands: [() => import('../commands/main.js')],
        providers: [() => import('@adonisjs/core/providers/app_provider')],
      },
    })
    .create(new URL('../', import.meta.url))
}

async function captureAce<T>(run: () => Promise<T>) {
  const output: string[] = []
  const originalWrite = process.stdout.write
  const originalErrorWrite = process.stderr.write
  const originalExitCode = process.exitCode
  const previousNodeEnvironment = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output.push(String(chunk))
    return originalWrite.call(process.stdout, chunk, ...(args as []))
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output.push(String(chunk))
    return originalErrorWrite.call(process.stderr, chunk, ...(args as []))
  }) as typeof process.stderr.write
  try {
    const result = await run()
    return { result, output: output.join('') }
  } finally {
    process.stdout.write = originalWrite
    process.stderr.write = originalErrorWrite
    process.exitCode = originalExitCode
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnvironment
  }
}

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
    const service = await f.create()
    await f.start(service)
    let resolveListenerError!: (error: unknown) => void
    const listenerRejected = new Promise<unknown>((resolve) => {
      resolveListenerError = resolve
    })
    const { output, result } = await captureAce(async () => {
      await createIgnitor(f.config)
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
      return process.exitCode
    })
    assert.equal(result, 0)
    assert.include(output, 'Expired 1 mode(s); deleted 0 event(s).')
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
    const { output, result } = await captureAce(async () => {
      await createIgnitor(f.config).ace().handle(['masquerade:prune', '--batch-size=2'])
      return process.exitCode
    })
    assert.equal(result, 1)
    assert.lengthOf(
      output.match(
        /Prune failed during read: confirmed expired 1 mode\(s\); confirmed deleted 1 event\(s\)\./g
      ) ?? [],
      1
    )
    assert.notInclude(output, 'Masquerade is unavailable')
    assert.notInclude(output, 'may also have committed')
    const persisted = await read(f.owner)
    assert.equal(persisted?.state, 'idle')
    assert.deepEqual(
      f.store.events.map((event) => event.kind),
      ['expired']
    )
    f.store.read = read
    assert.deepEqual(await pruneMasquerade(f.config, f.dependencies), {
      expired: 0,
      eventsDeleted: 0,
    })
  })

  test('reports uncertainty once and returns the typed failure from Kernel.exec', async ({
    assert,
  }) => {
    const f = fixture()
    await f.start(await f.create())
    const compareAndSet = f.store.compareAndSet.bind(f.store)
    f.store.compareAndSet = async (input) => {
      await compareAndSet(input)
      return { status: 'indeterminate', transitionId: input.event.id }
    }

    const { output, result: command } = await captureAce(async () => {
      const app = createIgnitor(f.config).createApp('console')
      await app.init()
      await app.boot()
      await app.start(() => {})
      try {
        const kernel = new Kernel(app)
        kernel.addLoader(() => import('../commands/main.js'))
        return await kernel.exec('masquerade:prune', [])
      } finally {
        await app.terminate()
      }
    })

    assert.equal(command.exitCode, 1)
    assert.instanceOf(command.error, errors.E_MASQUERADE_PRUNE_PROGRESS)
    const error = command.error as InstanceType<typeof errors.E_MASQUERADE_PRUNE_PROGRESS>
    assert.equal(error.code, 'E_MASQUERADE_PRUNE_PROGRESS')
    assert.equal(error.phase, 'expiry_commit')
    assert.deepEqual(error.completed, { expired: 0, eventsDeleted: 0 })
    assert.isTrue(error.indeterminate)
    assert.include(
      output,
      'Prune failed during expiry_commit: confirmed expired 0 mode(s); confirmed deleted 0 event(s). The failed operation may also have committed.'
    )
    assert.lengthOf(output.match(/Prune failed during/g) ?? [], 1)
    assert.notInclude(output, 'Masquerade is unavailable')
    const persisted = await f.store.read(f.owner)
    assert.equal(persisted?.state, 'idle')
  })

  test('lets Ace render invalid batch-size failures', async ({ assert }) => {
    const { output, result } = await captureAce(async () => {
      await createIgnitor(fixture().config).ace().handle(['masquerade:prune', '--batch-size=0'])
      return process.exitCode
    })
    assert.equal(result, 1)
    assert.include(output, '--batch-size must be an integer from 1 to 1000')
    assert.notInclude(output, 'Prune failed during')
  })
})
