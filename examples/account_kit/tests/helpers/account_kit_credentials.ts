import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { AccountKitHttp } from '#tests/helpers/account_kit_http'
import { cleanUsers, createUsers } from '#tests/helpers/users'

export const accountKitPassword = 'AccountKitPass123!'
export const accountKitNextPassword = 'AccountKitNextPass123!'
const createdAccountIds = new Set<number>()

export async function createAccountKitUsers() {
  const users = await createUsers()
  users.actor.password = accountKitPassword
  users.actor.emailVerifiedAt = DateTime.now()
  users.target.password = accountKitPassword
  users.target.emailVerifiedAt = DateTime.now()
  await users.actor.save()
  await users.target.save()
  createdAccountIds.add(users.actor.id)
  createdAccountIds.add(users.target.id)
  return users
}

export async function cleanAccountKitUsers() {
  if (createdAccountIds.size && (await db.connection().schema.hasTable('account_sessions'))) {
    await db
      .from('account_sessions')
      .whereIn('user_id', [...createdAccountIds])
      .delete()
  }
  createdAccountIds.clear()
  await cleanUsers()
}

export async function loginAccountKitUser(email: string, password = accountKitPassword) {
  const client = new AccountKitHttp()
  const strategy =
    process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens' ? 'access_tokens' : 'session'
  const { csrf, token } = await client.login(email, password, strategy)
  return { client, credential: token ? `Bearer ${token}` : '', csrf: csrf ?? '' }
}

export async function accountKitRequest(
  client: AccountKitHttp,
  path: string,
  credential: string,
  init: RequestInit = {}
) {
  const headers = new Headers(init.headers)
  if (!headers.has('accept')) headers.set('accept', 'application/json')
  if (credential.startsWith('Bearer ')) headers.set('Authorization', credential)
  return client.request(path, { ...init, headers })
}

export function accountKitJson(
  client: AccountKitHttp,
  path: string,
  credential: string,
  csrf: string,
  body: object,
  headers: Record<string, string> = {}
) {
  return client.json(path, 'POST', body, {
    ...headers,
    ...(credential.startsWith('Bearer ') ? { Authorization: credential } : {}),
    ...(csrf ? { 'x-csrf-token': csrf } : {}),
  })
}

export function accountKitDelete(
  client: AccountKitHttp,
  path: string,
  credential: string,
  csrf: string
) {
  return accountKitRequest(client, path, credential, {
    method: 'DELETE',
    headers: csrf ? { 'x-csrf-token': csrf } : {},
  })
}

export function masqueradePaths() {
  const tokenStrategy = process.env.ACCOUNT_KIT_AUTH_STRATEGY === 'access_tokens'
  return {
    tokenStrategy,
    control: tokenStrategy ? '/api/masquerade' : '/masquerade',
    business: tokenStrategy ? '/api/support/customer' : '/business',
  }
}
