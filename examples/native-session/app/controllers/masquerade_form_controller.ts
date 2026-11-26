import { MasqueradeFormTransitionService } from '#services/masquerade_form_transition_service'
import { inject } from '@adonisjs/core'
import { HttpContext } from '@adonisjs/core/http'
import { MasqueradeController } from '@kevinjohn/adonisjs-masquerade/http'
import type { FormAction } from '#services/masquerade_form_transition_service'
export type { MasqueradeFormFlash } from '#services/masquerade_form_transition_service'

/** Host-owned HTML form adapter. This is the generated --form-controller starter. */
@inject()
export default class MasqueradeFormController extends MasqueradeController {
  #context: HttpContext

  constructor(context: HttpContext = HttpContext.getOrFail()) {
    super()
    this.#context = context
  }

  redirectAfterStart(): string {
    return '/'
  }

  redirectAfterStop(): string {
    return '/'
  }

  override async start({ containerResolver, request }: HttpContext): Promise<void> {
    if (!acceptsHtmlForm(request)) return super.start(this.#context)
    const transition = await containerResolver.make(MasqueradeFormTransitionService)
    await transition.run(
      this.#context,
      'start',
      () => this.formTransition(this.#context, 'start'),
      () => this.successPath('start'),
      () => this.errorPath()
    )
  }

  override async stop({ containerResolver, request }: HttpContext): Promise<void> {
    if (!acceptsHtmlForm(request)) return super.stop(this.#context)
    const transition = await containerResolver.make(MasqueradeFormTransitionService)
    await transition.run(
      this.#context,
      'stop',
      () => this.formTransition(this.#context, 'stop'),
      () => this.successPath('stop'),
      () => this.errorPath()
    )
  }

  successPath(action: FormAction): string {
    return action === 'start' ? this.redirectAfterStart() : this.redirectAfterStop()
  }

  errorPath(): string {
    return '/'
  }
}

function acceptsHtmlForm(request: HttpContext['request']): boolean {
  const accept = request.header('accept')
  const explicitlyAcceptsHtml = accept?.split(',').some((entry) => {
    const mediaType = entry.split(';', 1)[0]?.trim().toLowerCase()
    return mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
  })
  return Boolean(explicitlyAcceptsHtml && request.accepts(['html', 'json']) === 'html')
}
