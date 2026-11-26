import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
const createdIds = new Set<number>()

export async function createUsers() {
  const suffix = crypto.randomUUID()
  const actor = await User.create({
    email: `actor-${suffix}@example.test`,
    password: 'secret',
    fullName: 'Actor',
    active: true,
    canMutate: false,
    masqueradeOperator: true,
    securityStamp: 'actor-v1',
  })
  createdIds.add(actor.id)
  const target = await User.create({
    email: `target-${suffix}@example.test`,
    password: 'secret',
    fullName: 'Target',
    active: true,
    canMutate: true,
    masqueradeOperator: false,
    securityStamp: 'target-v1',
  })
  createdIds.add(target.id)
  return { actor, target }
}

export async function cleanUsers() {
  const ids = [...createdIds]
  if (ids.length === 0) return

  const ownerIds = ids.map(String)
  if (await db.connection().schema.hasTable('masquerade_events')) {
    await db.from('masquerade_events').whereIn('actor_id', ownerIds).delete()
    await db.from('masquerade_modes').whereIn('actor_id', ownerIds).delete()
  }
  if (await db.connection().schema.hasTable('auth_access_tokens')) {
    await db.from('auth_access_tokens').whereIn('tokenable_id', ids).delete()
  }
  if (await db.connection().schema.hasTable('account_sessions')) {
    await db.from('account_sessions').whereIn('user_id', ids).delete()
  }
  await db.from('remember_me_tokens').whereIn('tokenable_id', ids).delete()
  await User.query().whereIn('id', ids).delete()
  createdIds.clear()
}
