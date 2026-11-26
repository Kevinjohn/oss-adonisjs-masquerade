import { test } from '@japa/runner'
import type { ModeAccess, ResolvedContext } from '../index.ts'

test('resolved context fields are narrowed by isMasquerading', ({ expectTypeOf }) => {
  // Type assertions below intentionally include calls that must fail compilation.
  const compileCases = () => {
    const context = null as unknown as ResolvedContext

    if (context.isMasquerading) {
      const { modeId, access, ...identity } = context
      const narrowed: [string, ModeAccess] = [modeId, access]

      // @ts-expect-error An active fixture needs its mode ID.
      const missingId: ResolvedContext = { ...identity, access }
      // @ts-expect-error An active fixture needs its access level.
      const missingAccess: ResolvedContext = { ...identity, modeId }
      void [narrowed, missingId, missingAccess]
    } else {
      const modeId: undefined = context.modeId
      const access: undefined = context.access
      // @ts-expect-error An idle fixture cannot carry a mode ID.
      const idleWithId: ResolvedContext = { ...context, modeId: 'old-mode' }
      // @ts-expect-error An idle fixture cannot carry an access level.
      const idleWithAccess: ResolvedContext = { ...context, access: 'view' }
      void [modeId, access, idleWithId, idleWithAccess]
    }
  }
  expectTypeOf(compileCases).toBeFunction()
  expectTypeOf<Extract<ResolvedContext, { isMasquerading: true }>>().toHaveProperty('modeId')
})
