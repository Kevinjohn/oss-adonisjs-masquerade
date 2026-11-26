import { test } from '@japa/runner'
import { requireValidSubject } from '../src/subject_validation.ts'
import { fixture } from './helpers/core.ts'

test('validates bounded canonical IDs and immutable incarnations against authority mapping', ({
  assert,
}) => {
  const f = fixture()
  const user = f.users.get('a')!
  const subject = { id: 'a', incarnation: 'a', user }
  assert.strictEqual(requireValidSubject(subject, f.config.authority), subject)
  for (const patch of [
    { id: '' },
    { id: 'x'.repeat(256) },
    { id: ['a'] },
    { id: '\uD800' },
    { id: 'a\uDC00' },
    { incarnation: 'x'.repeat(129) },
    { incarnation: '\uD800' },
    { incarnation: 'different' },
    { incarnation: ['a'] },
  ])
    assert.throws(
      () => requireValidSubject({ ...subject, ...patch } as never, f.config.authority),
      'Masquerade is unavailable'
    )
  assert.strictEqual(
    requireValidSubject(subject, { ...f.config.authority, incarnation: 'id' }),
    subject
  )
  assert.strictEqual(
    requireValidSubject(
      { ...subject, id: 'astral-😀', incarnation: 'astral-😀' },
      {
        ...f.config.authority,
        incarnation: 'id',
      }
    ).id,
    'astral-😀'
  )
})
