import { NativeCookieJar } from '#tests/helpers/native_cookie_jar'

/** Real HTTP client: Japa's session API plugin replaces cookies between requests. */
export class AccountKitHttp extends NativeCookieJar {
  async login(email: string, password: string, strategy: 'session' | 'access_tokens') {
    const csrf = strategy === 'session' ? await this.csrf() : undefined
    const response = await this.json(
      '/kit/auth/login',
      'POST',
      { email, password },
      csrf ? { 'x-csrf-token': csrf } : {}
    )
    if (response.status !== 200)
      throw new Error(`Kit login returned ${response.status}: ${await response.text()}`)
    const result = (await response.json()) as { token?: string }
    if (strategy === 'access_tokens' && typeof result.token !== 'string')
      throw new Error('Kit login omitted bearer token')
    return { csrf: strategy === 'session' ? await this.csrf() : undefined, token: result.token }
  }

  async csrf() {
    const response = await this.request('/kit/auth/csrf', {
      headers: { accept: 'application/json' },
    })
    if (response.status !== 200) throw new Error(`Kit CSRF returned ${response.status}`)
    const body = (await response.json()) as { csrfToken?: unknown }
    if (typeof body.csrfToken !== 'string') throw new Error('Kit CSRF omitted its token')
    return body.csrfToken
  }

  json(
    path: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body: object,
    headers: Record<string, string | undefined> = {}
  ) {
    const extra = Object.fromEntries(
      Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
    return this.request(path, {
      method,
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        ...extra,
      },
      body: JSON.stringify(body),
    })
  }
}
