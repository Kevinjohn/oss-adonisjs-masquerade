import { test } from '@japa/runner'
import { stampFrom } from '../native/main.js'

test('changes the stamp when any selected security field changes', ({ assert }) => {
  type User = {
    password: string
    role: string
    suspendedAt: string | null
    sessionEpoch: number
    email: string
  }

  const securityStamp = stampFrom<User>((user) => [
    user.password,
    user.role,
    user.suspendedAt,
    user.sessionEpoch,
  ])
  const original: User = {
    password: 'password-hash-v1',
    role: 'support',
    suspendedAt: null,
    sessionEpoch: 3,
    email: 'person@example.com',
  }
  const originalStamp = securityStamp(original)
  assert.match(originalStamp, /^[a-f0-9]{64}$/)

  for (const changed of [
    { ...original, password: 'password-hash-v2' },
    { ...original, role: 'customer' },
    { ...original, suspendedAt: '2026-10-25T12:00:00.000Z' },
    { ...original, sessionEpoch: 4 },
  ]) {
    assert.notEqual(securityStamp(changed), originalStamp)
  }

  assert.equal(securityStamp({ ...original, email: 'other@example.com' }), originalStamp)
})

test('frames selected fields and their types unambiguously', ({ assert }) => {
  const pairStamp = stampFrom<{ first: string; second: string }>((user) => [
    user.first,
    user.second,
  ])
  const stringStamp = stampFrom<{ value: string }>((user) => [user.value])
  const numberStamp = stampFrom<{ value: number }>((user) => [user.value])
  const optionalStamp = stampFrom<{ value: null | undefined }>((user) => [user.value])

  assert.notEqual(pairStamp({ first: 'ab', second: 'c' }), pairStamp({ first: 'a', second: 'bc' }))
  assert.notEqual(stringStamp({ value: '1' }), numberStamp({ value: 1 }))
  assert.notEqual(optionalStamp({ value: null }), optionalStamp({ value: undefined }))
})
