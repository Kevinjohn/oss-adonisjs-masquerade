type StoredCookie = {
  value: string
  expiresAt?: number
}

/** A small HTTP cookie jar for direct requests to the running fixture server. */
export class NativeCookieJar {
  readonly #cookies = new Map<string, StoredCookie>()

  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    const cookie = this.cookieHeader()
    if (cookie) headers.set('cookie', cookie)

    const response = await fetch(fixtureUrl(path), {
      ...init,
      headers,
      redirect: init.redirect ?? 'manual',
    })

    for (const header of response.headers.getSetCookie()) this.#store(header)
    return response
  }

  has(name: string) {
    this.#discardExpired()
    return this.#cookies.has(name)
  }

  cookieValue(name: string) {
    this.#discardExpired()
    return this.#cookies.get(name)?.value
  }

  cookieHeader() {
    this.#discardExpired()
    return [...this.#cookies.entries()]
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join('; ')
  }

  #store(header: string) {
    const [pair, ...attributes] = header.split(';')
    const separator = pair.indexOf('=')
    if (separator < 1) return

    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    const options = new Map(
      attributes.map((attribute) => {
        const [key, ...parts] = attribute.trim().split('=')
        return [key.toLowerCase(), parts.join('=')] as const
      })
    )
    const maxAge = Number(options.get('max-age'))
    const expiresAt = Number.isFinite(maxAge)
      ? Date.now() + maxAge * 1000
      : options.has('expires')
        ? Date.parse(options.get('expires')!)
        : undefined

    if (maxAge === 0 || (expiresAt !== undefined && expiresAt <= Date.now())) {
      this.#cookies.delete(name)
      return
    }

    this.#cookies.set(name, { value, expiresAt })
  }

  #discardExpired() {
    const now = Date.now()
    for (const [name, cookie] of this.#cookies) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) {
        this.#cookies.delete(name)
      }
    }
  }
}

export function fixtureUrl(path: string) {
  const host = process.env.HOST ?? '127.0.0.1'
  const port = process.env.PORT ?? '3333'
  return new URL(path, `http://${host}:${port}`)
}
