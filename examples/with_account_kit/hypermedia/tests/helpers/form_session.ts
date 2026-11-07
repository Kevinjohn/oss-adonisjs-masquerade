const origin = process.env.APP_URL!

/** A cookie-keeping client for native forms: manual redirects, the rendered CSRF token. */
export class FormSession {
  private cookies = new Map<string, string>()
  private csrf?: string
  html = ''

  async request(path: string, form?: Record<string, string>, accept = 'text/html') {
    const headers = new Headers({
      accept,
      cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
    })
    if (form) headers.set('content-type', 'application/x-www-form-urlencoded')
    const response = await fetch(new URL(path, origin), {
      method: form ? 'POST' : 'GET',
      headers,
      body: form ? new URLSearchParams({ ...form, _csrf: this.csrf ?? '' }) : undefined,
      redirect: 'manual',
    })
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(';')[0].split('=', 2)
      this.cookies.set(name, value ?? '')
    }
    this.html = response.headers.get('content-type')?.includes('text/html')
      ? await response.text()
      : ''
    const token = this.field('_csrf')
    if (token) this.csrf = token
    return response
  }

  /** The value of the first input with this name on the last page. */
  field(name: string) {
    const input = this.html.match(new RegExp(`<input\\b[^>]*\\bname=["']${name}["'][^>]*>`))?.[0]
    return input?.match(/\bvalue=["']([^"']*)["']/)?.[1]
  }

  async login(email: string, password: string) {
    await this.request('/login')
    const response = await this.request('/login', { email, password })
    if (!response.headers.get('location')?.endsWith('/dashboard'))
      throw new Error(`Login for ${email} did not sign in`)
  }
}
