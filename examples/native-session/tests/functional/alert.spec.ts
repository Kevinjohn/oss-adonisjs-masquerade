import { test } from '@japa/runner'
import { mock } from 'node:test'
import edge from 'edge.js'

test.group('alerts', () => {
  type AlertState = {
    isVisible: boolean
    dismiss(): void
    init(): void
  }

  const alertModuleUrl = new URL('../../resources/js/components/alert.js', import.meta.url).href

  async function loadAlertData() {
    return (await import(alertModuleUrl)) as {
      default: (options?: { autoDismiss?: boolean }) => AlertState
    }
  }

  test('keeps alerts visible when auto-dismiss is disabled', async ({ assert }) => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const { default: alertData } = await loadAlertData()
      const alert = alertData({ autoDismiss: false })
      alert.init()

      mock.timers.tick(79)
      assert.isFalse(alert.isVisible)
      mock.timers.tick(1)
      assert.isTrue(alert.isVisible)
      mock.timers.tick(6000)
      assert.isTrue(alert.isVisible)

      alert.dismiss()
      assert.isFalse(alert.isVisible)
    } finally {
      mock.timers.reset()
    }
  })

  test('auto-dismisses alerts by default and when explicitly enabled', async ({ assert }) => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const { default: alertData } = await loadAlertData()
      for (const options of [undefined, { autoDismiss: true }]) {
        const alert = alertData(options)
        alert.init()

        mock.timers.tick(79)
        assert.isFalse(alert.isVisible)
        mock.timers.tick(1)
        assert.isTrue(alert.isVisible)
        mock.timers.tick(4919)
        assert.isTrue(alert.isVisible)
        mock.timers.tick(1)
        assert.isFalse(alert.isVisible)
      }
    } finally {
      mock.timers.reset()
    }
  })

  test('passes the alert auto-dismiss option into the Alpine data factory', async ({ assert }) => {
    const renderer = edge.createRenderer().share({
      request: { plainCookie: () => 'light' },
      auth: { user: null },
      flashMessages: { has: () => true, get: () => 'Saved' },
    })
    const cases = [
      { props: '{ autoDismiss: false }', expected: 'false' },
      { props: '{ autoDismiss: true }', expected: 'true' },
      { props: '', expected: 'true' },
    ]

    for (const { props, expected } of cases) {
      const html = await renderer.renderRaw(`@alert.root(${props})\nAlert\n@end`)
      assert.include(html, `x-data="alert({ autoDismiss: ${expected} })"`)
    }
  })
})
