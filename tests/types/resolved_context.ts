import type { ModeAccess, ResolvedContext } from '../../index.js'

declare const context: ResolvedContext

if (context.isMasquerading) {
  const modeId: string = context.modeId
  const access: ModeAccess = context.access
  const { modeId: _modeId, access: _access, ...identity } = context

  // @ts-expect-error An active fixture needs its mode ID.
  const missingId: ResolvedContext = { ...identity, access }
  // @ts-expect-error An active fixture needs its access level.
  const missingAccess: ResolvedContext = { ...identity, modeId }
  void [missingId, missingAccess]
} else {
  const modeId: undefined = context.modeId
  const access: undefined = context.access
  // @ts-expect-error An idle fixture cannot carry a mode ID.
  const idleWithId: ResolvedContext = { ...context, modeId: 'old-mode' }
  // @ts-expect-error An idle fixture cannot carry an access level.
  const idleWithAccess: ResolvedContext = { ...context, access: 'view' }
  void [modeId, access, idleWithId, idleWithAccess]
}
