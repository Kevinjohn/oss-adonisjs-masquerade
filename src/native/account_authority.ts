import type { SessionAuthorityOptions } from '../types.ts'
import type { NativeAuthority, Subject } from '../types.ts'
import { E_MASQUERADE_UNAVAILABLE } from '../errors.ts'
import { isBoundedString } from '../bounded_string.ts'

export function buildSubject<User>(
  user: User,
  identifier: unknown,
  incarnation: 'id' | ((user: User) => string)
): Subject<User> {
  if (
    typeof identifier !== 'string' &&
    typeof identifier !== 'bigint' &&
    !(typeof identifier === 'number' && Number.isSafeInteger(identifier))
  )
    throw new E_MASQUERADE_UNAVAILABLE()
  const id = String(identifier)
  const accountIncarnation = incarnation === 'id' ? id : incarnation(user)
  if (!isBoundedString(id, 255) || !isBoundedString(accountIncarnation, 128))
    throw new E_MASQUERADE_UNAVAILABLE()
  return { id, incarnation: accountIncarnation, user }
}

export class AccountAuthority<User> implements NativeAuthority<User> {
  declare readonly namespace: string
  declare readonly guard: string
  declare readonly incarnation: 'id' | ((user: User) => string)
  declare readonly securityStamp: SessionAuthorityOptions<User>['securityStamp']
  declare readonly inspectAccount: NativeAuthority<User>['inspectAccount']
  #provider: SessionAuthorityOptions<User>['provider']
  #isActive: SessionAuthorityOptions<User>['isActive']

  constructor(options: SessionAuthorityOptions<User>) {
    this.namespace = options.namespace
    this.guard = options.guard
    this.incarnation = options.incarnation === 'id' ? 'id' : options.incarnation.bind(options)
    this.securityStamp = options.securityStamp.bind(options)
    this.#provider = options.provider
    this.#isActive = options.isActive.bind(options)
    this.inspectAccount = this.#inspectAccount.bind(this)
    Object.freeze(this)
  }

  async #inspectAccount(id: string) {
    const account = await this.#provider.findById(id)
    if (!account) return null
    const user = account.getOriginal()
    const active = await this.#isActive(user)
    if (typeof active !== 'boolean') throw new E_MASQUERADE_UNAVAILABLE()
    return {
      subject: buildSubject(user, account.getId(), this.incarnation),
      active,
      securityStamp: await this.securityStamp(user),
    }
  }
}
