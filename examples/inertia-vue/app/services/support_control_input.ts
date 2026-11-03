import type { HttpContext } from '@adonisjs/core/http'
import type { StartInput, StopInput } from '@kevinjohn/adonisjs-masquerade/types'

/** Preserve the context token that accompanied the original form intent. */
export function controlInput(ctx: HttpContext, action: 'start'): StartInput
export function controlInput(ctx: HttpContext, action: 'stop'): StopInput
export function controlInput(ctx: HttpContext, action: 'start' | 'stop'): StartInput | StopInput {
  const body = ctx.request.body()
  const keys =
    action === 'start'
      ? ['targetId', 'reason', 'access', '_masqueradeContext', '_csrf']
      : ['_masqueradeContext', '_csrf']
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !keys.includes(key))
  ) {
    return { __invalidHttpInput: true } as unknown as StartInput
  }
  const header = ctx.request.header('X-Masquerade-Context')
  const hidden = body._masqueradeContext
  const expectedContext =
    header !== undefined && hidden !== undefined && header !== hidden
      ? `0.${'0'.repeat(32)}`
      : (header ?? hidden)
  if (action === 'stop')
    return { expectedContext: typeof expectedContext === 'string' ? expectedContext : '' }
  return {
    targetId: body.targetId as StartInput['targetId'],
    reason: body.reason as StartInput['reason'],
    access: body.access as StartInput['access'],
    expectedContext: typeof expectedContext === 'string' ? expectedContext : '',
  }
}
