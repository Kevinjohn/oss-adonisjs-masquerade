import type {
  MasqueradeBlockedBy,
  MasqueradeErrorCode,
  MasqueradeSetupErrorCode,
  MasqueradeSetupErrorField,
} from '../../src/types.js'
import type * as root from '../../index.js'

// The ./types entry carries the same error types as the root, which keeps its own exports.
const code: MasqueradeErrorCode = 'E_MASQUERADE_UNAVAILABLE'
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
