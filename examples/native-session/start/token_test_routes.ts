import { Bouncer } from '@adonisjs/bouncer'
import { allowMutation, sensitive } from '@kevinjohn/adonisjs-masquerade/http'
import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import type User from '#models/user'

router
  .get('/api/business', async (ctx) => {
    const { auth } = ctx
    const actor = auth.use('api').user!
    const effective = auth.user as User
    const bouncer = new Bouncer<User>(() => (auth.user as User | undefined) ?? null)
    return {
      actorId: actor.id,
      effectiveId: effective.id,
      getUserOrFailId: (auth.getUserOrFail() as User).id,
      authenticatedViaGuard: auth.authenticatedViaGuard,
      rawActorId: actor.id,
      bouncerUserId: (await bouncer.allows(
        Bouncer.ability((user: User) => user.id === effective.id)
      ))
        ? effective.id
        : null,
      silentAuthSnapshot: (
        ctx as typeof ctx & { silentAuthSnapshot?: { guard?: string; userId?: number } }
      ).silentAuthSnapshot,
      actorHasCurrentAccessToken: Boolean(auth.use('api').user?.currentAccessToken),
      actorCurrentAccessTokenId: auth.use('api').user?.currentAccessToken.identifier,
      effectiveHasCurrentAccessToken: Boolean(
        (auth.user as (User & { currentAccessToken?: unknown }) | undefined)?.currentAccessToken
      ),
    }
  })
  .use(middleware.auth({ guards: ['api_effective'] }))

router
  .post('/api/business/mutate', async ({ auth }) => {
    const bouncer = new Bouncer<User>(() => (auth.user as User | undefined) ?? null)
    await bouncer.authorize(Bouncer.ability((user: User) => Boolean(user.canMutate)))
    return { ran: true, effectiveId: (auth.user as User).id }
  })
  .use(allowMutation())
  .use(middleware.auth({ guards: ['api_effective'] }))

router
  .post('/api/business/sensitive', async () => ({ ran: true }))
  .use(allowMutation())
  .use(sensitive())
  .use(middleware.auth({ guards: ['api_effective'] }))

router
  .get('/api/raw-business', async ({ auth }) => ({ actorId: auth.use('api').user!.id }))
  .use(middleware.auth({ guards: ['api'] }))
