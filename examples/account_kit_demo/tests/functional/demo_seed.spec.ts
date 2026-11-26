import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { demoAccounts } from '#services/demo_accounts'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import app from '@adonisjs/core/services/app'

const execFile = promisify(execFileCallback)
const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const seed = () =>
  execFile(process.execPath, ['ace.js', 'demo:kit-seed'], {
    cwd: appRoot,
    env: { ...process.env, NODE_ENV: 'test' },
  })

test.group('demo:kit-seed', (group) => {
  group.setup(() => testUtils.db().migrate())
  test('inserts missing users, preserves edited rows, and restores admission', async ({
    assert,
  }) => {
    for (const account of demoAccounts)
      await db.from('users').where('email', account.email).delete()
    await seed()
    const first = await db
      .from('users')
      .whereIn(
        'email',
        demoAccounts.map((account) => account.email)
      )
      .orderBy('email')
    assert.lengthOf(first, 3)
    assert.isTrue(first.every((row) => row.email_verified_at !== null))
    const operator = first.find((row) => row.email === demoAccounts[0].email)!
    await db.from('users').where('id', operator.id).update({ full_name: 'My edited name' })
    const edited = await db
      .from('users')
      .whereIn(
        'email',
        demoAccounts.map((account) => account.email)
      )
      .orderBy('email')
    const admission = await app.container.make(AccountAdmission)
    await admission.operator.revoke({ email: demoAccounts[0].email })
    await seed()
    assert.deepEqual(
      await db
        .from('users')
        .whereIn(
          'email',
          demoAccounts.map((account) => account.email)
        )
        .orderBy('email'),
      edited
    )
    assert.isTrue(await admission.isAdmitted(operator.id))
    await db
      .from('users')
      .whereIn(
        'email',
        demoAccounts.map((account) => account.email)
      )
      .delete()
  })
})
