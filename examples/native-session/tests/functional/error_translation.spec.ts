import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade'

router.get('/__test/masquerade-errors/:language', async (ctx) => {
  const error = new MasqueradeError('E_MASQUERADE_CONTEXT_REQUIRED')
  error.message = 'Private diagnostic detail'
  if (ctx.params.language === 'host') {
    Object.assign(ctx, {
      i18n: {
        t: (key: string, _data: Record<string, unknown>, fallback: string) =>
          key === 'errors.E_MASQUERADE_CONTEXT_REQUIRED' ? 'Host translation' : fallback,
      },
    })
  }
  throw error
})

test('renders the fixed English fallback through the real exception handler', async ({
  client,
}) => {
  const response = await client
    .get('/__test/masquerade-errors/english')
    .header('Accept', 'application/json')

  response.assertStatus(428)
  response.assertBody({
    errors: [{ code: 'E_MASQUERADE_CONTEXT_REQUIRED', message: 'Masquerade context required' }],
  })
})

test('uses the host translator and keeps the real error response JSON-only', async ({ client }) => {
  const response = await client.get('/__test/masquerade-errors/host').header('Accept', 'text/html')

  response.assertStatus(428)
  response.assertBody({
    errors: [{ code: 'E_MASQUERADE_CONTEXT_REQUIRED', message: 'Host translation' }],
  })
})
