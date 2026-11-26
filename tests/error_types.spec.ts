import { test } from '@japa/runner'
import type {
  MasqueradeBlockedBy,
  MasqueradeErrorCode,
  MasqueradeSetupErrorCode,
  MasqueradeSetupErrorField,
} from '../src/types.ts'
import * as root from '../index.ts'

test('root and type entries expose identical exception types', ({ expectTypeOf }) => {
  // Type assertions below intentionally include calls that must fail compilation.
  const compileCases = () => {
    // The ./types entry carries the same error types as the root, which keeps its own exports.
    const code: MasqueradeErrorCode = 'E_MASQUERADE_UNAVAILABLE'
    const blockedBy: MasqueradeBlockedBy = 'view_only'
    const setupCode: MasqueradeSetupErrorCode = 'E_MASQUERADE_INVALID_CONFIGURATION'
    const field: MasqueradeSetupErrorField = 'permissions.canEdit'
    const rootCode: root.MasqueradeErrorCode = code
    const rootBlockedBy: root.MasqueradeBlockedBy = blockedBy
    const rootSetupCode: root.MasqueradeSetupErrorCode = setupCode
    const rootField: root.MasqueradeSetupErrorField = field

    // @ts-expect-error Unknown codes stay outside the public union.
    const unknown: MasqueradeErrorCode = 'E_MASQUERADE_UNKNOWN'

    void [rootCode, rootBlockedBy, rootSetupCode, rootField, unknown]

    // @ts-expect-error The blocked-action constructor requires the route cause.
    new root.errors.E_MASQUERADE_ACTION_BLOCKED()
    // @ts-expect-error The blocked-action constructor rejects unknown causes.
    new root.errors.E_MASQUERADE_ACTION_BLOCKED('unknown')
    // @ts-expect-error Other exceptions accept no blockedBy option.
    new root.errors.E_MASQUERADE_NOT_ALLOWED({ blockedBy: 'sensitive' })
    // @ts-expect-error Exception codes cannot be overridden through constructor options.
    new root.errors.E_MASQUERADE_NOT_ALLOWED({ code: 'E_OTHER' })
    const blocked = new root.errors.E_MASQUERADE_ACTION_BLOCKED('sensitive')
    // @ts-expect-error The route cause is read-only.
    blocked.blockedBy = 'view_only'
  }
  expectTypeOf(compileCases).toBeFunction()
  expectTypeOf<MasqueradeErrorCode>().toEqualTypeOf<root.MasqueradeErrorCode>()
})
