import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import vine from '@vinejs/vine'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { AccountAdmission, admissionMiddleware } from '@kevinjohn/adonisjs-account-kit/admission'
import { managedGuard } from '#services/account_kit_guard'

const changePasswordValidator = vine.compile(
  vine.object({
    currentPassword: vine.string(),
    newPassword: vine.string(),
  })
)

/**
 * Test-only host maintenance route used to prove that a kept native credential remains valid
 * across a real Account Kit credential revision. The production managed route is blocked while
 * masquerading, so this exercises the host-owned raw-actor path without changing that blocker.
 */
if (process.env.NODE_ENV === 'test') {
  router
    .post('/account/password', async (context) => {
      const { currentPassword, newPassword } =
        await context.request.validateUsing(changePasswordValidator)
      const current = await managedGuard.current(context)
      const kit = await app.container.make(AccountKit)
      const keepCurrent =
        managedGuard.strategy === 'session'
          ? current.sessionHandle
            ? { sessionHandle: current.sessionHandle }
            : {}
          : current.tokenId
            ? { tokenId: current.tokenId }
            : {}
      const { revision } = await kit.emailPasswordManagement.changePassword({
        actorId: current.userId,
        currentPassword,
        newPassword,
        keepCurrent,
      })
      if (managedGuard.strategy === 'session') {
        const guard = managedGuard.forRequest(context)
        if (guard.strategy === 'session') await guard.refresh?.(revision)
      }
      return context.response.ok({ changed: true })
    })
    .use(
      admissionMiddleware({
        admission: () => app.container.make(AccountAdmission),
        guard: managedGuard,
      })
    )

  // These raw-actor fixture routes call Account Kit's public session-management service. The
  // mounted managed routes are intentionally blocked while masquerading, so the fixture seam
  // allows acceptance tests to apply the real API to another sign-in without weakening the gate.
  router
    .delete('/account/sessions/:id', async (context) => {
      const current = await managedGuard.current(context)
      const kit = await app.container.make(AccountKit)
      const result = await kit.authentication.sessions.revoke({
        current,
        id: context.params.id,
      })
      return context.response.ok(result)
    })
    .use(
      admissionMiddleware({
        admission: () => app.container.make(AccountAdmission),
        guard: managedGuard,
      })
    )

  router
    .post('/account/sessions/revoke-others', async (context) => {
      const current = await managedGuard.current(context)
      const kit = await app.container.make(AccountKit)
      return context.response.ok(await kit.authentication.sessions.revokeOthers({ current }))
    })
    .use(
      admissionMiddleware({
        admission: () => app.container.make(AccountAdmission),
        guard: managedGuard,
      })
    )

  router
    .post('/account/sessions/revoke-all', async (context) => {
      const current = await managedGuard.current(context)
      const kit = await app.container.make(AccountKit)
      await kit.authentication.sessions.revokeAll({ current })
      return context.response.noContent()
    })
    .use(
      admissionMiddleware({
        admission: () => app.container.make(AccountAdmission),
        guard: managedGuard,
      })
    )
}
