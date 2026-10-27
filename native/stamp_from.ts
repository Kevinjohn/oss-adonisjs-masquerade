import { createHash } from 'node:crypto'

export type StampField = string | number | boolean | bigint | null

/**
 * Build a stable security stamp from the host-selected account fields.
 * Date-like values must be converted to a stable string by the selector.
 */
export function stampFrom<User>(
  select: (user: User) => readonly [StampField, ...StampField[]]
): (user: User) => string {
  return (user) => {
    const fields: unknown = select(user)
    if (!Array.isArray(fields) || fields.length === 0)
      throw new TypeError('Security stamp selector must return at least one field')

    const hash = createHash('sha256')
    for (const field of fields) {
      const [tag, value] = encodeField(field)
      const byteLength = Buffer.byteLength(value, 'utf8')
      const length = Buffer.allocUnsafe(8)
      length.writeBigUInt64BE(BigInt(byteLength))
      hash.update(tag).update(length).update(value, 'utf8')
    }
    return hash.digest('hex')
  }
}

function encodeField(value: unknown): [tag: string, value: string] {
  if (value === null) return ['l', '']
  if (value === undefined)
    throw new TypeError('Security stamp fields must not be undefined; use null for an empty value')
  if (typeof value === 'string') {
    if (!value.isWellFormed())
      throw new TypeError('Security stamp fields must be well-formed strings')
    return ['s', value]
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Security stamp fields must be finite numbers')
    return ['n', Object.is(value, -0) ? '-0' : String(value)]
  }
  if (typeof value === 'boolean') return ['b', value ? '1' : '0']
  if (typeof value === 'bigint') return ['i', String(value)]
  throw new TypeError('Security stamp fields must be scalar values')
}
