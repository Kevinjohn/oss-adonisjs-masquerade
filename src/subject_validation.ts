import { E_MASQUERADE_ACTOR_SUBJECT_INVALID } from './errors.js'
import { isBoundedString } from './bounded_string.js'
import type { Subject, NativeAuthority } from './types.js'

export function requireValidSubject<User>(
  subject: Subject<User>,
  authority: NativeAuthority<User>
): Subject<User> {
  if (!subject || !isBoundedString(subject.id, 255) || !isBoundedString(subject.incarnation, 128))
    throw new E_MASQUERADE_ACTOR_SUBJECT_INVALID()
  let incarnation: string
  try {
    incarnation = authority.incarnation === 'id' ? subject.id : authority.incarnation(subject.user)
  } catch (error) {
    throw new E_MASQUERADE_ACTOR_SUBJECT_INVALID(error)
  }
  if (!isBoundedString(incarnation, 128) || incarnation !== subject.incarnation)
    throw new E_MASQUERADE_ACTOR_SUBJECT_INVALID()
  return subject
}
