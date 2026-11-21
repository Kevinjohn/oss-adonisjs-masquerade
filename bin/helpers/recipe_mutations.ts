/** Model a host dropping the hidden context input before delegation. */
export const formTokenMutation = {
  original: 'await this.formTransition(ctx, action)',
  replacement: [
    'const body = { ...ctx.request.body() }',
    'delete body._masqueradeContext',
    'ctx.request.updateBody(body)',
    'await this.formTransition(ctx, action)',
  ].join('\n      '),
  expectedAssertion: 'recipe form start redirect',
}
