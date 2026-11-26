import type { HttpContext } from '@adonisjs/core/http'
import type { MasqueradeErrorCode } from '@kevinjohn/adonisjs-masquerade'
import { isMasqueradeRequestError } from '@kevinjohn/adonisjs-masquerade/http'

export type FormAction = 'start' | 'stop'
export type MasqueradeFormFlash =
  { type: 'success'; action: 'started' | 'stopped' } | { type: 'error'; code: MasqueradeErrorCode }

/** Adapt the control result to a flash message and a host-owned redirect. */
export class MasqueradeFormTransitionService {
  async run(
    { response, session }: HttpContext,
    action: FormAction,
    transition: () => Promise<unknown>,
    successPath: () => string,
    errorPath: () => string
  ): Promise<void> {
    response.header('Cache-Control', 'private, no-store')
    response.vary(['Accept', 'X-Masquerade-Context'])
    try {
      await transition()
      session.flash({
        masquerade: {
          type: 'success',
          action: action === 'start' ? 'started' : 'stopped',
        } satisfies MasqueradeFormFlash,
      })
      response.redirect().toPath(successPath())
    } catch (error) {
      if (!isMasqueradeRequestError(error)) throw error
      session.flash({
        masquerade: { type: 'error', code: error.code } satisfies MasqueradeFormFlash,
      })
      response.redirect().toPath(errorPath())
    }
  }
}
