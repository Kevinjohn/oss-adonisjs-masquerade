const origin = process.env.APP_URL!

/**
 * A cookie-keeping client that sends what Inertia's router sends: the Inertia headers, JSON form
 * bodies and the XSRF token from Shield's cookie. Redirects are not followed.
 */
export class InertiaSession {
  private cookies = new Map<string, string>()
  private version: string | undefined

  async request(path: string, body?: Record<string, unknown>) {
    const headers = new Headers({
      'accept': 'text/html, application/xhtml+xml',
      'cookie': [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      'x-inertia': 'true',
    })
    if (this.version) headers.set('x-inertia-version', this.version)
    if (body) {
      headers.set('content-type', 'application/json')
      headers.set('x-xsrf-token', decodeURIComponent(this.cookies.get('XSRF-TOKEN') ?? ''))
    }
    const response = await fetch(new URL(path, origin), {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    })
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(';')[0].split('=', 2)
      if (name) this.cookies.set(name, value ?? '')
    }
    return response
  }

  /** The props of an Inertia page. */
  async props<Props>(path: string) {
    let response = await this.request(path)
    // A missing or stale asset version answers 409 with the current one, as for a real client.
    if (response.status === 409) {
      this.version = response.headers.get('x-inertia-version') ?? undefined
      response = await this.request(path)
    }
    if (response.status !== 200) throw new Error(`${path} answered ${response.status}`)
    const page = (await response.json()) as { version: string; props: Props }
    this.version = page.version
    return page.props
  }

  async login(email: string, password: string) {
    await this.props('/login')
    const response = await this.request('/login', { email, password })
    if (!response.headers.get('location')?.endsWith('/dashboard'))
      throw new Error(`Login for ${email} did not sign in`)
  }
}
