import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { getCommand, getMetaData } from '../commands/main.js'
import { OPERATOR_STOP_OUTCOME } from '../src/stop_modes.js'
import { fixture } from './helpers/core.js'

async function ace(
  config: unknown,
  argv: string[],
  logger?: { info(...args: unknown[]): void; error(...args: unknown[]): void },
  answer?: boolean,
  output?: string[]
) {
  const ignitor = new IgnitorFactory()
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
  const kernel = ignitor.ace()
  let exitCode: number | undefined
  // Ace prints a command's error itself; keep it when the test asks for the output.
  const print = { log: console.log, error: console.error }
  if (output) {
    console.log = (...args: unknown[]) => output.push(args.map(String).join(' '))
    console.error = console.log
  }
  await kernel
    .configure(async (app) => {
      await app.boot()
      if (logger) app.container.bindValue('logger', logger as never)
      if (answer !== undefined) {
        const commands = await app.container.make('ace')
        commands.executing((command) => {
          const trap = command.prompt.trap('End every active masquerade mode?')
          if (answer) trap.accept()
          else trap.reject()
        })
      }
    })
    .handle(argv)
    .finally(() => {
      console.log = print.log
      console.error = print.error
    })
  exitCode = process.exitCode as number | undefined
  process.exitCode = 0
  return exitCode
}

test.group('masquerade:status and masquerade:stop Ace commands', () => {
  test('are discoverable through the package command loader', async ({ assert }) => {
    const metadata = await getMetaData()
    const status = metadata.find((command) => command.commandName === 'masquerade:status')
    const stop = metadata.find((command) => command.commandName === 'masquerade:stop')
    assert.equal(status?.flags.find((flag) => flag.flagName === 'limit')?.type, 'number')
    assert.sameMembers(stop?.flags.map((flag) => flag.flagName) ?? [], [
      'actor',
      'incarnation',
      'all',
      'force',
    ])
    const { default: StatusCommand } = await import('../commands/status.js')
    const { default: StopCommand } = await import('../commands/stop.js')
    assert.equal(await getCommand(status!), StatusCommand)
    assert.equal(await getCommand(stop!), StopCommand)
  })

  test('status lists and stop ends a mode through Ace', async ({ assert }) => {
    const f = fixture()
    Object.defineProperty(f.store, 'testOnly', { value: false })
    // The command reads the real clock, so the mode must still be live now.
    f.state.now = Date.now()
    const service = await f.create()
    await f.start(service)
    assert.notEqual(await ace(f.config, ['masquerade:status']), 1)
    const loggerCalls: unknown[][] = []
    const logger = {
      info: (...args: unknown[]) => loggerCalls.push(args),
      error: (...args: unknown[]) => loggerCalls.push(args),
    }
    assert.notEqual(await ace(f.config, ['masquerade:stop', '--actor=a'], logger), 1)
    assert.include(
      loggerCalls.map((args) => args[1]),
      'Masquerade transition'
    )
    const row = await f.store.read(f.owner)
    assert.equal(row?.state, 'idle')
    assert.equal(f.store.events.at(-1)?.outcomeCode, OPERATOR_STOP_OUTCOME)
  })

  test('out-of-range --limit and --batch-size are input errors, not outages', async ({
    assert,
  }) => {
    const f = fixture()
    Object.defineProperty(f.store, 'testOnly', { value: false })
    for (const argv of [
      ['masquerade:status', '--limit=0'],
      ['masquerade:prune', '--batch-size=1001'],
    ]) {
      const output: string[] = []
      assert.equal(await ace(f.config, argv, undefined, undefined, output), 1)
      assert.isTrue(output.some((line) => line.includes('must be an integer from 1 to 1000')))
    }
  })

  test('stop --all asks first and stops nothing when the answer is no', async ({ assert }) => {
    const f = fixture()
    Object.defineProperty(f.store, 'testOnly', { value: false })
    f.state.now = Date.now()
    const service = await f.create()
    await f.start(service)
    await ace(f.config, ['masquerade:stop', '--all'], undefined, false)
    const declined = await f.store.read(f.owner)
    assert.equal(declined?.state, 'active')
    await ace(f.config, ['masquerade:stop', '--all'], undefined, true)
    const confirmed = await f.store.read(f.owner)
    assert.equal(confirmed?.state, 'idle')
    assert.equal(f.store.events.at(-1)?.outcomeCode, OPERATOR_STOP_OUTCOME)
  })

  test('stop --all --force ends every mode; bad flag combinations stop nothing', async ({
    assert,
  }) => {
    const f = fixture()
    // The command reads the real clock, so the modes must be live by it.
    f.state.now = Date.now()
    Object.defineProperty(f.store, 'testOnly', { value: false })
    const service = await f.create()
    await f.start(service)
    await f.start(service, { actorId: 'c' })
    assert.equal(await ace(f.config, ['masquerade:stop']), 1)
    assert.equal(await ace(f.config, ['masquerade:stop', '--actor=a', '--all']), 1)
    assert.equal(await ace(f.config, ['masquerade:stop', '--all', '--incarnation=a']), 1)
    assert.lengthOf(await f.store.activeBatch({ limit: 10 }), 2)
    assert.notEqual(await ace(f.config, ['masquerade:stop', '--all', '--force']), 1)
    assert.deepEqual(await f.store.activeBatch({ limit: 10 }), [])
    assert.deepEqual(
      f.store.events.slice(-2).map((event) => [event.kind, event.outcomeCode]),
      [
        ['invalidated', OPERATOR_STOP_OUTCOME],
        ['invalidated', OPERATOR_STOP_OUTCOME],
      ]
    )
  })

  test('stop reports an unknown operator account without stopping anything', async ({ assert }) => {
    const f = fixture()
    Object.defineProperty(f.store, 'testOnly', { value: false })
    const service = await f.create()
    await f.start(service)
    f.users.delete('a')
    assert.equal(await ace(f.config, ['masquerade:stop', '--actor=a']), 1)
    const row = await f.store.read(f.owner)
    assert.equal(row?.state, 'active')
  })
})
