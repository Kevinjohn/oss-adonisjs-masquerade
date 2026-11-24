import type {
  MasqueradeBlockedBy,
  MasqueradeErrorCode,
  MasqueradeSetupErrorCode,
  MasqueradeSetupErrorField,
} from '../../src/types.js'
import * as root from '../../index.js'

// The ./types entry carries the same error types as the root, which keeps its own exports.
const code: MasqueradeErrorCode = 'E_MASQUERADE_GUARD_DRIVER_MISMATCH'
const blockedBy: MasqueradeBlockedBy = 'view_only'
const setupCode: MasqueradeSetupErrorCode = 'E_MASQUERADE_INVALID_CONFIGURATION'
const field: MasqueradeSetupErrorField = 'policy.canEdit'
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
new root.errors.E_MASQUERADE_TOKEN_ABILITY_REQUIRED({ blockedBy: 'sensitive' })
// @ts-expect-error Exception codes cannot be overridden through constructor options.
new root.errors.E_MASQUERADE_TOKEN_ABILITY_REQUIRED({ code: 'E_OTHER' })
const blocked = new root.errors.E_MASQUERADE_ACTION_BLOCKED('sensitive')
// @ts-expect-error The route cause is read-only.
blocked.blockedBy = 'view_only'

// @ts-expect-error Zero-data exceptions do not take options or a message.
new root.errors.E_MASQUERADE_UNKNOWN_COMMIT({ status: 418 })
// @ts-expect-error An operational exception accepts one cause, with no options argument.
new root.errors.E_MASQUERADE_STORE_READ_FAILED(new Error('read failed'), { status: 418 })
// @ts-expect-error A setup exception takes its field directly.
new root.errors.E_MASQUERADE_INVALID_CONFIGURATION('config', { status: 418 })
