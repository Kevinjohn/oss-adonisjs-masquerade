import { test } from '@japa/runner'
import assert from 'node:assert/strict'
import {
  initJsonClient,
  type ClientRequest,
  type ClientElement,
  type ClientListener,
} from '../../resources/js/demo_json.js'

interface FixtureElement extends ClientElement {
  listeners: Record<string, ClientListener>
  focused: boolean
}

function fixture(
  fetchRef: (path: string, options: ClientRequest) => Promise<Response>,
  now = () => 1000
) {
  const selectedAccess = { value: 'view' }
  const ids = [
    'json-client',
    'json-notice',
    'json-mode',
    'json-start-panel',
    'json-active-panel',
    'json-customer',
    'json-preference',
    'json-setting',
    'json-sensitive',
    'json-stop',
    'json-deadline',
    'json-refresh',
    'json-start',
    'json-target',
    'json-reason',
  ]
  const elements: Record<string, FixtureElement> = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        dataset: id === 'json-client' ? { csrf: 'shield-token' } : {},
        hidden: false,
        disabled: false,
        textContent: '',
        value: '',
        listeners: {} as FixtureElement['listeners'],
        focused: false,
        addEventListener(name: string, callback: FixtureElement['listeners'][string]) {
          this.listeners[name] = callback
        },
        focus(this: FixtureElement) {
          this.focused = true
        },
        reset() {
          elements['json-target'].value = ''
          elements['json-reason'].value = ''
        },
      },
    ])
  )
  const documentRef = {
    visibilityState: 'visible',
    listeners: {} as FixtureElement['listeners'],
    getElementById(id: string) {
      return elements[id]
    },
    querySelector() {
      return selectedAccess
    },
    addEventListener(name: string, callback: FixtureElement['listeners'][string]) {
      this.listeners[name] = callback
    },
  }
  initJsonClient({ documentRef, fetchRef, now, schedule() {} })
  return { elements, documentRef, selectedAccess }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function active(token: string, targetId = '2') {
  return {
    isMasquerading: true,
    contextToken: token,
    targetId,
    expiresAt: new Date(500_000).toISOString(),
  }
}

function customer(token: string, email: string) {
  return {
    actor: { email: 'operator@example.test' },
    customer: { email },
    mode: { contextToken: token, expiresAt: new Date(500_000).toISOString() },
    emailUpdates: false,
    canEdit: true,
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('captures context and Shield CSRF with the constructed preference intent', async () => {
  const requests: { path: string; options: ClientRequest }[] = []
  const { elements } = fixture(async (path, options) => {
    requests.push({ path, options })
    if (path === '/masquerade') return json(active('revision-1'))
    if (path === '/support/json/customer')
      return json(customer('revision-1', 'customer-one@example.test'))
    return json({ emailUpdates: true, contextToken: 'revision-1' })
  })
  await tick()
  elements['json-setting'].value = '1'
  elements['json-preference'].listeners.submit({ preventDefault() {} })
  await tick()
  const mutation = requests.find(({ path }) => path === '/support/json/customer/preference')
  assert.ok(mutation)
  assert.equal(mutation.options.credentials, 'same-origin')
  assert.equal(mutation.options.headers.Accept, 'application/json')
  assert.equal(mutation.options.headers['X-CSRF-TOKEN'], 'shield-token')
  assert.equal(mutation.options.headers['X-Masquerade-Context'], 'revision-1')
  assert.deepEqual(JSON.parse(mutation.options.body!), { emailUpdates: '1' })
})

test('ignores a delayed customer A response after a newer context loads customer B', async () => {
  let releaseA!: (response: Response) => void
  const delayedA = new Promise<Response>((resolve) => {
    releaseA = resolve
  })
  let reads = 0
  const { elements } = fixture(async (path) => {
    if (path === '/masquerade')
      return json(active(++reads === 1 ? 'A' : 'B', reads === 1 ? '2' : '3'))
    if (path === '/support/json/customer')
      return reads === 1 ? delayedA : json(customer('B', 'customer-two@example.test'))
    throw new Error(path)
  })
  await tick()
  elements['json-refresh'].listeners.click({ preventDefault() {} })
  await tick()
  assert.match(elements['json-customer'].textContent, /customer-two@example.test/)
  releaseA(json(customer('A', 'customer-one@example.test')))
  await tick()
  assert.match(elements['json-customer'].textContent, /customer-two@example.test/)
  assert.doesNotMatch(elements['json-customer'].textContent, /customer-one@example.test/)
})

test('reads status after an uncertain transition without replaying the old start', async () => {
  const requests: { path: string; options: ClientRequest }[] = []
  const { elements, selectedAccess } = fixture(async (path, options) => {
    requests.push({ path, options })
    if (path === '/masquerade') return json({ isMasquerading: false, contextToken: 'idle' })
    return json({ code: 'E_MASQUERADE_UNAVAILABLE', message: 'Unavailable' }, 503)
  })
  await tick()
  elements['json-target'].value = '2'
  elements['json-reason'].value = 'Customer request'
  selectedAccess.value = 'edit'
  elements['json-start'].listeners.submit({ preventDefault() {} })
  await tick()
  assert.deepEqual(
    requests.map(({ path }) => path),
    ['/masquerade', '/masquerade/start', '/masquerade']
  )
  assert.equal(JSON.parse(requests[1].options.body!).access, 'edit')
  assert.match(elements['json-notice'].textContent, /may have completed/)
  assert.equal(elements['json-target'].value, '')
  assert.equal(elements['json-reason'].value, '')
})

test('keeps raw stop usable when the stored mode has reached its fixed deadline', async () => {
  const requests: { path: string; options: ClientRequest }[] = []
  const { elements } = fixture(
    async (path, options) => {
      requests.push({ path, options })
      if (path === '/masquerade') return json(active('expired-context'))
      return json({ isMasquerading: false, contextToken: 'idle' })
    },
    () => 500_000
  )
  await tick()
  assert.equal(elements['json-preference'].hidden, true)
  assert.equal(elements['json-stop'].disabled, false)
  elements['json-stop'].listeners.click({ preventDefault() {} })
  await tick()
  const stop = requests.find(({ path }) => path === '/masquerade/stop')
  assert.ok(stop)
  assert.equal(stop.options.headers['X-Masquerade-Context'], 'expired-context')
})

test('does not claim completion when a successful POST is followed by a failed status read', async () => {
  let statusReads = 0
  const { elements } = fixture(async (path) => {
    if (path === '/masquerade') {
      statusReads++
      return statusReads === 1 ? json(active('current')) : json({ message: 'Unavailable' }, 503)
    }
    if (path === '/support/json/customer')
      return json(customer('current', 'customer-one@example.test'))
    return json({ emailUpdates: true, contextToken: 'current' })
  })
  await tick()
  elements['json-setting'].value = '1'
  elements['json-preference'].listeners.submit({ preventDefault() {} })
  await tick()
  assert.match(elements['json-notice'].textContent, /may have completed/)
  assert.doesNotMatch(elements['json-notice'].textContent, /Action completed/)
  assert.equal(elements['json-preference'].hidden, true)
})

test('a Shield redirect gives session and CSRF recovery without replaying the request', async () => {
  const requests: string[] = []
  const { elements } = fixture(async (path) => {
    requests.push(path)
    if (path === '/masquerade') return json(active('current'))
    if (path === '/support/json/customer')
      return json(customer('current', 'customer-one@example.test'))
    return new Response(null, { status: 302, headers: { location: '/support/json' } })
  })
  await tick()
  elements['json-setting'].value = '1'
  elements['json-preference'].listeners.submit({ preventDefault() {} })
  await tick()
  assert.deepEqual(requests, [
    '/masquerade',
    '/support/json/customer',
    '/support/json/customer/preference',
    '/masquerade',
    '/support/json/customer',
  ])
  assert.match(elements['json-notice'].textContent, /Session or CSRF protection changed/)
  assert.equal(elements['json-notice'].focused, true)
  assert.equal(requests.filter((path) => path === '/support/json/customer/preference').length, 1)
})
