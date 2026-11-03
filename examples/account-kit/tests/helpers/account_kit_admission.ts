import app from '@adonisjs/core/services/app'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import User from '#models/user'

export async function approveUsers(...users: User[]) {
  const admission = await app.container.make(AccountAdmission)
  for (const user of users) await admission.operator.approve({ email: user.email })
}
