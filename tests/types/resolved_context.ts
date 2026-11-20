import type { ModeAccess, ResolvedContext } from '../../index.js'

declare const context: ResolvedContext

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
