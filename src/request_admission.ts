import type { ModeView, ResolvedContext, Subject } from './types.js'
/**
 * Internal integration seam; deliberately absent from the root public API.
 * @internal
 */
export const admitOnce = Symbol('requestAdmission')
/** @internal */
export interface RequestAdmission<User> {
  readonly context: ResolvedContext
  readonly view: ModeView
  readonly actor: Readonly<Subject<User>>
  readonly effective: Readonly<Subject<User>>
}
