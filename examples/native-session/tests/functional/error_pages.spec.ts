import { test } from '@japa/runner'
import edge from 'edge.js'
import type { HttpContext } from '@adonisjs/core/http'
import server from '@adonisjs/core/services/server'

test.group('error pages', () => {
  let renderProductionStatusPage = false

  server.errorHandler(async () => {
    const { default: HttpExceptionHandler } = await import('#exceptions/handler')

    return {
      default: class TestHttpExceptionHandler extends HttpExceptionHandler {
        override async handle(error: unknown, ctx: HttpContext) {
          if (renderProductionStatusPage && ctx.request.url() === '/this-route-does-not-exist') {
            const previousDebug = this.debug
            const previousRenderStatusPages = this.renderStatusPages

            this.debug = false
            this.renderStatusPages = true

            try {
              return await super.handle(error, ctx)
            } finally {
              this.debug = previousDebug
              this.renderStatusPages = previousRenderStatusPages
            }
          }

          return super.handle(error, ctx)
        }
      },
    }
  })

  test('renders error pages inside the marketing layout', async ({ assert }) => {
    const pages = [
      {
        template: 'pages/errors/server_error',
        error: { code: 500 },
        message: 'The server hit an unexpected error.',
      },
      {
        template: 'pages/errors/not_found',
        error: { code: 404 },
        message: "That route hasn't been built yet.",
      },
    ]
    const renderer = edge.createRenderer().share({
      request: { plainCookie: () => 'light' },
      auth: { user: null },
      flashMessages: { has: () => false, get: () => undefined },
    })

    for (const page of pages) {
      const html = await renderer.render(page.template, { error: page.error })

      assert.notInclude(html, '@marketing')
      assert.isTrue(html.trimStart().startsWith('<!DOCTYPE html>'))
      assert.include(html, '<header class="header header--floating">')
      assert.include(html, page.message)
    }
  })

  test('renders a missing route as the original 404 response', async ({ client, assert }) => {
    renderProductionStatusPage = true
    try {
      const response = await client.get('/this-route-does-not-exist').header('Accept', 'text/html')

      response.assertStatus(404)
      assert.include(response.text(), "That route hasn't been built yet.")
      assert.notInclude(response.text(), 'TypeError')
      assert.notInclude(response.text(), 'Cannot read properties of undefined')
    } finally {
      renderProductionStatusPage = false
    }
  })

  test('renders status pages without authenticated or session view shares', async ({ assert }) => {
    const renderer = edge.createRenderer().share({
      request: { plainCookie: () => 'light' },
    })

    for (const template of ['pages/errors/not_found', 'pages/errors/server_error']) {
      const html = await renderer.render(template, {
        error: { code: template.endsWith('not_found') ? 404 : 500 },
      })

      assert.isTrue(html.trimStart().startsWith('<!DOCTYPE html>'))
      assert.notInclude(html, 'TypeError')
    }
  })
})
