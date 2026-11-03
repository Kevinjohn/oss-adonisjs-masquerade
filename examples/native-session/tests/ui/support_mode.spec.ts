import { test } from '@japa/runner'
import assert from 'node:assert/strict'
import {
  initSupportMode,
  type SupportDocument,
  type SupportNodes,
} from '../../resources/js/components/support_mode.js'

function page(expiresAt: string) {
  const label = { textContent: '' }
  const badge = { textContent: '', classList: { remove() {} } }
  const notice = {
    hidden: true,
    textContent: '',
    focused: false,
    closest() {
      return null
    },
    focus() {
      this.focused = true
      documentRef.activeElement = notice
    },
  }
  const button = { disabled: false }
  const intent = {
    hidden: false,
    querySelectorAll() {
      return [button]
    },
  }
  const root = {
    dataset: { expiresAt, contextToken: 'captured-token' },
    classList: { remove() {} },
    querySelector<K extends keyof SupportNodes>(selector: K): SupportNodes[K] {
      const nodes: SupportNodes = {
        '[data-mode-label]': label,
        '[data-mode-badge]': badge,
        '[data-mode-notice]': notice,
      }
      return nodes[selector]
    },
  }
  const listeners: Record<string, () => void | Promise<void>> = {}
  const documentRef: SupportDocument = {
    visibilityState: 'visible',
    activeElement: { closest: () => intent },
    querySelector() {
      return root
    },
    querySelectorAll() {
      return [intent]
    },
    addEventListener(name: string, callback: () => void | Promise<void>) {
      listeners[name] = callback
    },
  }
  return { documentRef, listeners, button, intent, notice, label }
}

test('a rendered page freezes its captured customer intent at the fixed deadline', () => {
  let currentTime = 1_000
  let scheduled!: () => void
  const rendered = page(new Date(2_000).toISOString())
  initSupportMode({
    documentRef: rendered.documentRef,
    windowRef: { addEventListener() {} },
    now: () => currentTime,
    schedule(callback, delay) {
      assert.equal(delay, 1_000)
      scheduled = callback
    },
  })
  assert.equal(rendered.intent.hidden, false)
  currentTime = 2_000
  scheduled()
  assert.equal(rendered.intent.hidden, true)
  assert.equal(rendered.button.disabled, true)
  assert.equal(rendered.notice.hidden, false)
  assert.equal(rendered.notice.focused, true)
  assert.match(rendered.notice.textContent, /deadline has passed/)
  assert.equal(rendered.documentRef.activeElement, rendered.notice)
})

test('a visible return checks raw status and freezes even when the token is unchanged', async () => {
  const rendered = page(new Date(Date.now() + 60_000).toISOString())
  let requested!: { path: string; options: RequestInit }
  initSupportMode({
    documentRef: rendered.documentRef,
    windowRef: { addEventListener() {} },
    fetchStatus: async (path, options) => {
      requested = { path, options }
      return {
        ok: true,
        json: async () => ({ isMasquerading: true, contextToken: 'captured-token' }),
      }
    },
    schedule() {},
  })
  const checking = rendered.listeners.visibilitychange()
  assert.equal(rendered.intent.hidden, true)
  assert.equal(rendered.button.disabled, true)
  await checking
  assert.equal(requested.path, '/masquerade')
  assert.equal(requested.options.cache, 'no-store')
  assert.equal(rendered.intent.hidden, true)
  assert.equal(rendered.button.disabled, true)
  assert.match(rendered.notice.textContent, /reopen the customer page/)
})
