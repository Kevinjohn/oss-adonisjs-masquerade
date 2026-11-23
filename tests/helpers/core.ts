import { createMasqueradeService, defineConfig } from '../../index.js'
import { MemoryControlStore } from '../../testing/main.js'
import type { CompleteMasqueradeConfig } from '../../src/define_config.js'
import type { AccountSnapshot, ModeAccess, ServiceDependencies, Subject } from '../../src/types.js'
export type User = { id: string; stamp: string; incarnation: string; privateData: string }
export type Request = { actorId?: string; credentialInvalid?: boolean; denied?: boolean }
export function fixture() {
  const users = new Map<string, User>(
    ['a', 'b', 'c'].map((id) => [
      id,
      { id, stamp: `secret-${id}`, incarnation: id, privateData: 'private-model' },
    ])
  )
  const store = new MemoryControlStore()
  const state = {
    now: Date.parse('2026-01-01T00:00:00.000Z'),
    policy: true,
    local: true,
    localThrows: false,
    policyThrows: false,
    inspectThrows: false,
    malformedStamp: false,
    authenticateCount: 0,
    inspectCount: 0,
    policyCount: 0,
    editCount: 0,
    edit: true as unknown,
    editThrows: false,
    editInputs: [] as unknown[],
  }
  const subject = (user: User): Subject<User> => ({
    id: user.id,
    incarnation: user.incarnation,
    user,
  })
  const config: CompleteMasqueradeConfig<User, Request> = {
    authority: {
      namespace: 'test',
      guard: 'web',
      incarnation: (user) => user.incarnation,
      inspectAccount: async (id): Promise<AccountSnapshot<User> | null> => {
        state.inspectCount++
        if (state.inspectThrows) throw new Error('inspection failure')
        const user = users.get(id)
        return user
          ? {
              subject: subject(user),
              active: true,
              securityStamp: state.malformedStamp ? '' : user.stamp,
            }
          : null
      },
    },
    policy: {
      canMasquerade: async () => {
        state.policyCount++
        if (state.policyThrows) throw new Error('policy failure')
        return state.policy
      },
      canEdit: async (input) => {
        state.editCount++
        state.editInputs.push(input)
        if (state.editThrows) throw new Error('edit policy failure')
        return state.edit as boolean
      },
      canUseRequest: async ({ request }) => {
        if (state.localThrows) throw new Error('local policy failure')
        return state.local && !request.denied
      },
    },
    store: async () => store,
    contextEnforcement: 'enforce',
    retention: 'host-managed',
  }
  const observed: unknown[] = []
  const diagnostics: unknown[] = []
  const failures: unknown[] = []
  const dependencies: ServiceDependencies<User, Request> = {
    environment: 'test',
    clock: () => new Date(state.now),
    authenticateActor: async (request) => {
      state.authenticateCount++
      if (request.credentialInvalid) throw new Error('native authentication failed')
      return subject(users.get(request.actorId ?? 'a')!)
    },
    emitter: {
      emit: (_name, event) => {
        observed.push(event)
      },
    },
    logger: {
      info: (event) => {
        observed.push(event)
      },
      error: (event) => {
        diagnostics.push(event)
      },
    },
    observerErrorHandler: (error) => {
      failures.push(error)
    },
  }
  const create = () => createMasqueradeService(defineConfig(config), dependencies)
  const start = async (
    service: Awaited<ReturnType<typeof create>>,
    request: Request = {},
    access?: ModeAccess
  ) => {
    const idle = await service.status(request)
    return service.start(request, {
      targetId: 'b',
      reason: ' support\r\ncase\t42 ',
      expectedContext: idle.contextToken,
      ...(access === undefined ? {} : { access }),
    })
  }
  return {
    users,
    store,
    state,
    config,
    dependencies,
    observed,
    diagnostics,
    failures,
    create,
    start,
    owner: { namespace: 'test', actorId: 'a', actorIncarnation: 'a' },
  }
}
export async function errorCode(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation()
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message
  }
  return 'NO_ERROR'
}
