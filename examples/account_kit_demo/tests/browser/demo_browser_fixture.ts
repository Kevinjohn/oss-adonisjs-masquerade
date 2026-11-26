import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { TestContext } from '@japa/runner/core'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { demoAccounts } from '#services/demo_accounts'

const execFile = promisify(execFileCallback)
const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const operatorEmail = demoAccounts[0].email
const customerEmails = demoAccounts.slice(1).map(({ email }) => email)

type Browser = TestContext['browser']
type BrowserContext = Awaited<ReturnType<Browser['newContext']>>
export type BrowserPage = Awaited<ReturnType<BrowserContext['newPage']>>
type Row = Record<string, unknown>

export type DemoBrowserState = {
  operator: Row
  customerIds: number[]
  operatorId: number
  modes: Row[]
  events: Row[]
  accountSessions: Row[]
  sessions: Row[]
  preferences: Row[]
}

export function baseUrl() {
  return `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? '3398'}`
}

export async function newDemoPage(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  return { context, page }
}

/** Use the real reserved-account command so verified and admitted users match the app. */
export async function seedDemoBrowserAccounts() {
  await execFile(process.execPath, ['ace.js', 'demo:kit-seed'], {
    cwd: appRoot,
    env: { ...process.env, NODE_ENV: 'test' },
  })
}

export async function captureDemoBrowserState(): Promise<DemoBrowserState> {
  const operator = await db.from('users').where('email', operatorEmail).first()
  const customers = await db.from('users').whereIn('email', customerEmails).select('id')
  if (!operator || customers.length !== customerEmails.length)
    throw new Error('The Account Kit browser fixture did not seed all reserved demo accounts.')

  const operatorId = Number(operator.id)
  const customerIds = customers.map(({ id }: { id: number }) => Number(id))
  const actorId = String(operatorId)
  const [modes, events, accountSessions, sessions, preferences] = await Promise.all([
    db.from('masquerade_modes').where('actor_id', actorId).select('*'),
    db.from('masquerade_events').where('actor_id', actorId).select('*'),
    db.from('account_sessions').where('user_id', operatorId).select('*'),
    db.from('sessions').where('user_id', actorId).select('*'),
    db.from('demo_preferences').whereIn('user_id', customerIds).select('*'),
  ])

  return {
    operator,
    customerIds,
    operatorId,
    modes,
    events,
    accountSessions,
    sessions,
    preferences,
  }
}

/** Remove only state changed by the current browser case and restore its original reversible rows. */
export async function restoreDemoBrowserState(before: DemoBrowserState | undefined) {
  try {
    if (!before) return

    const actorId = String(before.operatorId)
    await db
      .from('users')
      .where('id', before.operatorId)
      .update({ full_name: before.operator.full_name, updated_at: before.operator.updated_at })

    await db.from('masquerade_modes').where('actor_id', actorId).delete()
    if (before.modes.length) await db.table('masquerade_modes').insert(before.modes)
    await db.from('masquerade_events').where('actor_id', actorId).delete()
    if (before.events.length) await db.table('masquerade_events').insert(before.events)

    const priorAccountSessionIds = before.accountSessions.map((row) => String(row.id))
    const accountSessions = db.from('account_sessions').where('user_id', before.operatorId)
    if (priorAccountSessionIds.length) {
      await accountSessions.whereNotIn('id', priorAccountSessionIds).delete()
    } else {
      await accountSessions.delete()
    }

    const priorSessionIds = before.sessions.map((row) => String(row.id))
    const sessions = db.from('sessions').where('user_id', actorId)
    if (priorSessionIds.length) await sessions.whereNotIn('id', priorSessionIds).delete()
    else await sessions.delete()

    await db.from('demo_preferences').whereIn('user_id', before.customerIds).delete()
    if (before.preferences.length) await db.table('demo_preferences').insert(before.preferences)
  } finally {
    await limiter.clear(['memory'])
  }
}
