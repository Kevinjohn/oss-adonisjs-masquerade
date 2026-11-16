import { test } from '@japa/runner'

interface CurrentAccountSnapshot<User> {
  subject: { id: string; incarnation: string; user: User }
}

interface IdentityModule {
  currentAccountForAuditIdentity<User>(
    id: string | null,
    incarnation: string | null,
    inspectAccount: (id: string) => Promise<CurrentAccountSnapshot<User> | null>
  ): Promise<User | null>
}

async function currentAccountForAuditIdentity<User>(
  id: string | null,
  incarnation: string | null,
  inspectAccount: (id: string) => Promise<CurrentAccountSnapshot<User> | null>
): Promise<User | null> {
  const module = (await import(
    new URL('../examples/native-session/app/services/audit_history_identity.ts', import.meta.url)
      .href
  )) as IdentityModule
  return module.currentAccountForAuditIdentity(id, incarnation, inspectAccount)
}

test.group('audit history identity labels', () => {
  test('uses a current name only for the exact stored ID and incarnation', async ({ assert }) => {
    const account = { fullName: 'Current Name' }
    const inspectAccount = async (id: string) => ({
      subject: { id, incarnation: 'account-v1', user: account },
    })

    assert.equal(await currentAccountForAuditIdentity('42', 'account-v1', inspectAccount), account)
  })

  test('falls back when the ID now belongs to a different incarnation', async ({ assert }) => {
    const replacement = { fullName: 'Replacement Account' }
    const inspectAccount = async (id: string) => ({
      subject: { id, incarnation: 'account-v2', user: replacement },
    })

    assert.isNull(await currentAccountForAuditIdentity('42', 'account-v1', inspectAccount))
  })

  test('falls back when the account was deleted', async ({ assert }) => {
    assert.isNull(await currentAccountForAuditIdentity('42', 'account-v1', async () => null))
  })

  test('does not inspect or label an event without a verified incarnation', async ({ assert }) => {
    let inspected = false
    const inspectAccount = async () => {
      inspected = true
      return { subject: { id: '42', incarnation: 'account-v1', user: { fullName: 'Current' } } }
    }

    assert.isNull(await currentAccountForAuditIdentity('42', null, inspectAccount))
    assert.isFalse(inspected)
  })
})
