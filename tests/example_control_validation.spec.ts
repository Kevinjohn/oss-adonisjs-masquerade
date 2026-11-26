import { test } from '@japa/runner'
test.group('example control validation', () => {
  const controls = Promise.all([
    import(
      new URL('../examples/inertia-react/app/services/support_control_input.ts', import.meta.url)
        .href
    ),
    import(
      new URL('../examples/inertia-vue/app/services/support_control_input.ts', import.meta.url).href
    ),
    import(
      new URL('../examples/inertia-react/app/validators/support_control.ts', import.meta.url).href
    ),
    import(
      new URL('../examples/inertia-vue/app/validators/support_control.ts', import.meta.url).href
    ),
  ])

  test('preserves canonical input and rejects unknown controls after validation', async ({
    assert,
  }) => {
    const [
      { controlInput: reactControlInput },
      { controlInput: vueControlInput },
      { supportControlValidator: reactControlValidator },
      { supportControlValidator: vueControlValidator },
    ] = await controls
    for (const [validator, parse] of [
      [reactControlValidator, reactControlInput],
      [vueControlValidator, vueControlInput],
    ] as const) {
      const input = await validator.validate({
        targetId: 'customer',
        reason: 'Support',
        _masqueradeContext: 'original',
      })
      assert.deepEqual(parse(input, undefined, 'start'), {
        targetId: 'customer',
        reason: 'Support',
        expectedContext: 'original',
        ...(parse === vueControlInput ? { access: undefined } : {}),
      })
      const invalid = await validator.validate({ ...input, role: 'admin' })
      assert.deepEqual(parse(invalid, undefined, 'start'), { __invalidHttpInput: true })
    }
  })

  test('retains mismatched submitted tokens as a rejected context', async ({ assert }) => {
    const [
      { controlInput: reactControlInput },
      { controlInput: vueControlInput },
      { supportControlValidator: reactControlValidator },
      { supportControlValidator: vueControlValidator },
    ] = await controls
    for (const [validator, parse] of [
      [reactControlValidator, reactControlInput],
      [vueControlValidator, vueControlInput],
    ] as const) {
      const input = await validator.validate({ _masqueradeContext: 'original' })
      assert.deepEqual(parse(input, 'different', 'stop'), {
        expectedContext: `0.${'0'.repeat(32)}`,
      })
    }
  })

  test('validates both email preference choices and rejects other values', async ({ assert }) => {
    const { preferenceValidator } = await import(
      new URL('../examples/native-session/app/validators/preference.ts', import.meta.url).href
    )
    for (const emailUpdates of ['0', '1']) {
      const [error, data] = await preferenceValidator.tryValidate({ emailUpdates })
      assert.isNull(error)
      assert.equal(data?.emailUpdates, emailUpdates)
    }
    for (const emailUpdates of [undefined, true, 1, 'yes', ['1']]) {
      const [error] = await preferenceValidator.tryValidate({ emailUpdates })
      assert.isNotNull(error)
    }
  })
})
