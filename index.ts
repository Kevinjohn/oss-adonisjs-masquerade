import { join } from 'node:path'

/** Server-side account masquerade core. SQL and framework adapters are separate subpaths. */
export * from './src/types.ts'
export type { MasqueradeBlockedBy, MasqueradeErrorCode } from './src/types.ts'
export type { MasqueradeSetupErrorCode, MasqueradeSetupErrorField } from './src/types.ts'
export * as errors from './src/errors.ts'
export { defineConfig } from './src/define_config.ts'
export { createMasqueradeService } from './src/service.ts'
export { MasqueradeCallbackRegistration } from './src/callback_registration.ts'
export { MasqueradeRuntime } from './src/integration/runtime.ts'
export { configure } from './configure.ts'

/** Absolute path passed to the package configure hook for stub generation. */
export const stubsRoot = join(import.meta.dirname, 'stubs')
