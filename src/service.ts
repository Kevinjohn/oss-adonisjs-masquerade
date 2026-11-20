import { randomBytes, randomUUID } from 'node:crypto'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import { defineConfig } from './define_config.js'
import { contextToken, requireContext } from './context_token.js'
import { buildAdmittedProjection, modeView } from './mode_projection.js'
import { MasqueradeError } from './errors.js'
import { createInvalidInputError, createUnavailableError } from './error_helpers.js'
import { openControlStore } from './control_store.js'
import { requireStartSelection, assertStartInputShape } from './start_input.js'
import { stampHash } from './security_stamp.js'
import { isBoundedString } from './bounded_string.js'
import { requireValidModeRow } from './row_validation.js'
import { requireValidSubject } from './subject_validation.js'
import {
  commitTransition,
  idleAfterTransition,
  nextRevision,
  UnknownCommit,
} from './mode_transition.js'
import { admission } from './request_admission.js'
import { activeMode } from './active_mode.js'
import { actorIdentity } from './actor_identity.js'
import { reportDiagnostic } from './observers.js'
import type { RequestAdmission } from './request_admission.js'
import type {
  ActiveModeRow,
  AuditEvent,
  ControlOutcomeKind,
  RequestControlStore,
  EventKind,
  IdleModeRow,
  MasqueradeConfig,
  MasqueradeService,
  ModeRow,
  ModeView,
  OwnerKey,
  ServiceDependencies,
  StartInput,
  StopInput,
  Subject,
  AccountSnapshot,
  ResolvedContext,
  TransitionEvent,
} from './types.js'

/**
 * Create the core service shared by the provider, guards, controllers and commands. The config
 * and required dependencies are validated before opening the control store.
 *
 * Injection points on `dependencies`: `authenticateActor` resolves the native actor from the raw
 * guard (SPEC I01); `emitter`, `logger` and `observerErrorHandler` receive committed events and
 * bounded diagnostics (I09, I11); `clock` replaces `new Date()` for expiry (§7.3); `environment`
 * decides whether a test-only store may open.
 *
 * @throws {MasqueradeSetupError} `E_MASQUERADE_INVALID_CONFIGURATION` for an invalid config, or
 *   `E_MASQUERADE_INVALID_STORE` for a store that is missing methods or test-only outside tests.
 * @throws {MasqueradeError} `E_MASQUERADE_UNAVAILABLE` when the store factory throws.
 * @throws {InvalidArgumentsException} When `authenticateActor` or an observer or diagnostic port is missing.
 */
export async function createMasqueradeService<User, Request extends object>(
  config: MasqueradeConfig<User, Request, RequestControlStore>,
  dependencies: ServiceDependencies<User, Request>
): Promise<MasqueradeService<Request>> {
  let validated
  try {
    validated = defineConfig(config)
  } catch (error) {
    reportDiagnostic(dependencies, 'configuration', 'validate', 'E_MASQUERADE_UNAVAILABLE')
    throw error
  }
  if (typeof dependencies.authenticateActor !== 'function')
    throw new InvalidArgumentsException('Actor authentication resolver required')
  if (
    typeof dependencies.emitter?.emit !== 'function' ||
    typeof dependencies.logger?.info !== 'function' ||
    typeof dependencies.logger?.error !== 'function' ||
    typeof dependencies.observerErrorHandler !== 'function'
  )
    throw new InvalidArgumentsException('Observer and diagnostic ports required')
  let store: RequestControlStore
  try {
    store = await openControlStore(validated.store, dependencies.environment, [
      'read',
      'compareAndSet',
      'recordControlOutcome',
    ])
  } catch (error) {
    reportDiagnostic(dependencies, 'store', 'open', 'E_MASQUERADE_UNAVAILABLE')
    throw error
  }
  return new CoreService(validated, dependencies, store)
}

type AuditEventInput<Kind extends EventKind> = {
  owner: OwnerKey
  row: ModeRow | null
  kind: Kind
  outcomeCode: string
  reason?: string
}

type ControlOutcomeInput = {
  owner: OwnerKey
  row: ModeRow | null
  kind: ControlOutcomeKind
  outcomeCode: string
  attempted?: Pick<AuditEvent, 'targetId' | 'access'>
}

/**
 * Ordered orchestration of the SPEC §6.4 transition table. Admission, transitions, audit emission
 * and account inspection live together because the order of their checks is the contract
 * (AGENTS.md SRP rule 4): `start()` follows §7.1, `admit()` §7.2, `stop()` §7.3, and §14.1 adds
 * the edit checks. Each comment below names the invariant or transition row its check enforces.
 */
class CoreService<User, Request extends object> implements MasqueradeService<Request> {
  #viewsAfterInvalidation = new WeakMap<MasqueradeError, ModeView>()
  #admissionsByRequest = new WeakMap<Request, Promise<RequestAdmission<User>>>()
  constructor(
    private config: MasqueradeConfig<User, Request, RequestControlStore>,
    private dependencies: ServiceDependencies<User, Request>,
    private store: RequestControlStore
  ) {}
  private readCurrentTimestamp(): string {
    try {
      const date = (this.dependencies.clock ?? (() => new Date()))()
      const value = date.toISOString()
      if (!/^\d{4}-/.test(value)) throw createUnavailableError()
      return value
    } catch {
      throw createUnavailableError()
    }
  }
  private async authenticateActor(request: Request): Promise<Subject<User>> {
    // Native authentication errors retain their native rendering and never enter the audit boundary.
    const subject = await this.dependencies.authenticateActor(request)
    try {
      return requireValidSubject(subject, this.config.authority)
    } catch {
      throw createUnavailableError()
    }
  }
  private buildOwnerKey(actor: Subject<User>): OwnerKey {
    return {
      namespace: this.config.authority.namespace,
      actorId: actor.id,
      actorIncarnation: actor.incarnation,
    }
  }
  private async read(owner: OwnerKey): Promise<ModeRow | null> {
    try {
      return requireValidModeRow(await this.store.read(owner), owner)
    } catch {
      reportDiagnostic(this.dependencies, 'store', 'read', 'E_MASQUERADE_UNAVAILABLE')
      throw createUnavailableError()
    }
  }
  async [activeMode](owner: OwnerKey): Promise<boolean> {
    if (
      owner.namespace !== this.config.authority.namespace ||
      typeof owner.actorId !== 'string' ||
      typeof owner.actorIncarnation !== 'string'
    )
      throw createUnavailableError()
    const row = await this.read(owner)
    return row?.state === 'active' && this.readCurrentTimestamp() < row.expiresAt
  }
  /** The authenticated actor alone: no row read, policy call or invalidation. */
  async [actorIdentity](request: Request): Promise<{ id: string; incarnation: string }> {
    const actor = await this.authenticateActor(request)
    return { id: actor.id, incarnation: actor.incarnation }
  }
  private createAuditEvent<Kind extends EventKind>({
    owner,
    row,
    kind,
    outcomeCode,
    reason,
  }: AuditEventInput<Kind>): AuditEvent & { kind: Kind } {
    return {
      ...owner,
      id: randomUUID(),
      ...(row ? { modeId: row.modeId } : {}),
      ...(row?.state === 'active'
        ? { targetId: row.targetId, targetIncarnation: row.targetIncarnation, access: row.access }
        : {}),
      at: this.readCurrentTimestamp(),
      kind,
      outcomeCode,
      revision: row?.revision ?? 0,
      ...(reason === undefined ? {} : { reason }),
    }
  }
  private async recordControlOutcome({
    owner,
    row,
    kind,
    outcomeCode,
    attempted,
  }: ControlOutcomeInput): Promise<void> {
    try {
      const event = this.createAuditEvent({ owner, row, kind, outcomeCode })
      if (kind === 'start_denied') {
        delete event.targetId
        delete event.targetIncarnation
        delete event.access
        Object.assign(event, attempted)
      }
      await this.store.recordControlOutcome(event)
    } catch {
      reportDiagnostic(
        this.dependencies,
        'store',
        'record_control_outcome',
        'E_MASQUERADE_UNAVAILABLE'
      )
      throw createUnavailableError()
    }
  }
  private async commit(
    owner: OwnerKey,
    previous: ModeRow | null,
    next: ModeRow,
    event: TransitionEvent
  ): Promise<void> {
    let outcome: 'applied' | 'conflict'
    try {
      outcome = await commitTransition(this.store, this.dependencies, {
        owner,
        expected: previous?.revision ?? null,
        next,
        event,
      })
    } catch (error) {
      if (!(error instanceof UnknownCommit))
        reportDiagnostic(this.dependencies, 'store', 'compare_and_set', 'E_MASQUERADE_UNAVAILABLE')
      throw error
    }
    if (outcome === 'conflict') {
      await this.read(owner)
      throw new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED')
    }
  }
  private async clear(
    owner: OwnerKey,
    row: ActiveModeRow,
    kind: 'stopped' | 'expired' | 'invalidated',
    code: string
  ): Promise<IdleModeRow> {
    const event = this.createAuditEvent({ owner, row, kind, outcomeCode: code })
    const next = idleAfterTransition(row, event)
    event.revision = next.revision
    await this.commit(owner, row, next, event)
    return next
  }
  private async inspect(id: string): Promise<AccountSnapshot<User> | null> {
    try {
      const snapshot = await this.config.authority.inspectAccount(id)
      if (!snapshot) return null
      requireValidSubject(snapshot.subject, this.config.authority)
      if (typeof snapshot.active !== 'boolean') throw createUnavailableError()
      return snapshot
    } catch {
      reportDiagnostic(
        this.dependencies,
        'authority',
        'inspect_account',
        'E_MASQUERADE_UNAVAILABLE'
      )
      throw createUnavailableError()
    }
  }
  private eligibleActor(
    current: AccountSnapshot<User> | null,
    actor: Subject<User>
  ): current is AccountSnapshot<User> {
    return Boolean(
      current?.active &&
      current.subject.id === actor.id &&
      current.subject.incarnation === actor.incarnation
    )
  }
  private async checkMasqueradePermission(
    actor: Subject<User>,
    target: Subject<User>,
    request?: Request,
    reason?: string
  ): Promise<boolean> {
    try {
      const allowed =
        (await this.config.policy.canMasquerade({
          actor,
          target,
          ...(request === undefined ? {} : { request }),
          ...(reason === undefined ? {} : { reason }),
        })) === true
      if (!allowed)
        reportDiagnostic(this.dependencies, 'policy', 'can_masquerade', 'E_MASQUERADE_NOT_ALLOWED')
      return allowed
    } catch {
      reportDiagnostic(this.dependencies, 'policy', 'can_masquerade', 'E_MASQUERADE_UNAVAILABLE')
      throw createUnavailableError()
    }
  }
  private async assertRequestPermission(
    actor: Subject<User>,
    target: Subject<User>,
    request: Request
  ): Promise<void> {
    if (!this.config.policy.canUseRequest) return
    let allowed
    try {
      allowed = await this.config.policy.canUseRequest({ actor, target, request })
    } catch {
      reportDiagnostic(this.dependencies, 'policy', 'can_use_request', 'E_MASQUERADE_UNAVAILABLE')
      throw createUnavailableError()
    }
    if (allowed !== true) {
      reportDiagnostic(this.dependencies, 'policy', 'can_use_request', 'E_MASQUERADE_NOT_ALLOWED')
      throw new MasqueradeError('E_MASQUERADE_NOT_ALLOWED')
    }
  }
  private async checkEditPermission(
    actor: Subject<User>,
    target: Subject<User>,
    request?: Request,
    reason?: string
  ): Promise<boolean> {
    try {
      const allowed =
        (await this.config.policy.canEdit?.({
          actor,
          target,
          ...(request === undefined ? {} : { request }),
          ...(reason === undefined ? {} : { reason }),
        })) === true
      if (!allowed)
        reportDiagnostic(this.dependencies, 'policy', 'can_edit', 'E_MASQUERADE_NOT_ALLOWED')
      return allowed
    } catch {
      reportDiagnostic(this.dependencies, 'policy', 'can_edit', 'E_MASQUERADE_UNAVAILABLE')
      throw createUnavailableError()
    }
  }
  async status(request: Request): Promise<ModeView> {
    const actor = await this.authenticateActor(request)
    const owner = this.buildOwnerKey(actor)
    const row = await this.read(owner)
    nextRevision(row)
    return modeView(owner, row)
  }
  async start(request: Request, input: StartInput): Promise<ModeView> {
    const actor = await this.authenticateActor(request)
    const owner = this.buildOwnerKey(actor)
    let row: ModeRow | null = null
    // FR-27: a denial after input parsing records the requested target and access.
    let attempted: Pick<AuditEvent, 'targetId' | 'access'> | undefined
    try {
      // §6.4 Any: an unavailable store or malformed row is 503.
      row = await this.read(owner)
      // §7.1 step 1: input shape, then the expected context (§6.4 Any: mismatch is 409).
      assertStartInputShape(input)
      if (row?.state === 'active') {
        // Project only bounded request fields before checks that may reject an active mode.
        const projectedTargetId =
          typeof input.targetId === 'number' && Number.isSafeInteger(input.targetId)
            ? String(input.targetId)
            : input.targetId
        attempted = {
          ...(isBoundedString(projectedTargetId, 255) ? { targetId: projectedTargetId } : {}),
          ...(input.access === undefined || input.access === 'view' || input.access === 'edit'
            ? { access: input.access ?? 'view' }
            : {}),
        }
      }
      requireContext(input.expectedContext, contextToken(owner, row))
      // §6.4 Any: a revision at Number.MAX_SAFE_INTEGER fails closed.
      nextRevision(row)
      // §7.1 step 1, I06: an expired row resolves to idle first, then 409; never start from it.
      if (row?.state === 'active' && this.readCurrentTimestamp() >= row.expiresAt) {
        // The denial is recorded against the idle row this request committed.
        row = await this.clear(owner, row, 'expired', 'expired')
        throw new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED')
      }
      // §6.4 Active: any second start is 409 with no replacement or extension (I02).
      if (row?.state === 'active') throw new MasqueradeError('E_MASQUERADE_ALREADY_ACTIVE')
      // §7.1 step 3 reason policy, §14.1 access and the duration bounds.
      const { targetId, reason, duration, access } = requireStartSelection(input, {
        actorId: actor.id,
        defaultDuration: this.config.durationSeconds!,
        maxDuration: this.config.maxDurationSeconds!,
        reasonPolicy: this.config.reason!,
      })
      // Only the requested values: an inspected incarnation would reveal that the account exists.
      attempted = { targetId, access }
      // §7.1 step 2: both accounts come from inspectAccount; a throw is 503.
      const currentActor = await this.inspect(actor.id)
      const target = await this.inspect(targetId)
      // §7.3: self-targeting is invalid input.
      if (target?.subject.id === actor.id) throw createInvalidInputError()
      // §7.1 step 2: a missing or ineligible actor or target gets the generic denial.
      if (!this.eligibleActor(currentActor, actor) || !target?.active)
        throw new MasqueradeError('E_MASQUERADE_NOT_ALLOWED')
      // §6.4 Absent/idle: start requires canMasquerade to return true (§7.1 step 3).
      if (
        !(await this.checkMasqueradePermission(
          currentActor.subject,
          target.subject,
          request,
          reason ?? undefined
        ))
      )
        throw new MasqueradeError('E_MASQUERADE_NOT_ALLOWED')
      // §14.1: an edit start needs canEdit true, after canMasquerade and before canUseRequest.
      if (
        access === 'edit' &&
        !(await this.checkEditPermission(
          currentActor.subject,
          target.subject,
          request,
          reason ?? undefined
        ))
      )
        throw new MasqueradeError('E_MASQUERADE_NOT_ALLOWED')
      // §7.1 step 3: canUseRequest when configured.
      await this.assertRequestPermission(currentActor.subject, target.subject, request)
      // §7.1 step 3, I11: only the stamp hashes are kept.
      let actorHash: string
      let targetHash: string
      try {
        actorHash = stampHash(currentActor.securityStamp)
        targetHash = stampHash(target.securityStamp)
      } catch {
        reportDiagnostic(
          this.dependencies,
          'authority',
          'security_stamp',
          'E_MASQUERADE_UNAVAILABLE'
        )
        throw createUnavailableError()
      }
      const event = this.createAuditEvent({
        owner,
        row,
        kind: 'started',
        outcomeCode: 'started',
        reason: reason ?? undefined,
      })
      const next: ActiveModeRow = {
        ...owner,
        state: 'active',
        access,
        revision: nextRevision(row),
        revisionNonce: randomBytes(16).toString('hex'),
        modeId: randomUUID(),
        lastTransitionId: event.id,
        updatedAt: event.at,
        targetId: target.subject.id,
        targetIncarnation: target.subject.incarnation,
        actorStampHash: actorHash,
        targetStampHash: targetHash,
        reason,
        startedAt: event.at,
        expiresAt: new Date(Date.parse(event.at) + duration * 1000).toISOString(),
      }
      Object.assign(event, {
        modeId: next.modeId,
        targetId: next.targetId,
        targetIncarnation: next.targetIncarnation,
        access: next.access,
        revision: next.revision,
      })
      // §7.1 step 4, I05: CAS against the observed revision; a conflict is 409.
      await this.commit(owner, row, next, event)
      return modeView(owner, next)
    } catch (error) {
      // I09: an indeterminate commit may have applied, so it records no denial.
      if (error instanceof UnknownCommit) throw error
      // §6.4: every refused start records one start_denied outcome; I07: other errors are 503.
      reportDiagnostic(
        this.dependencies,
        'control',
        'start',
        error instanceof MasqueradeError ? error.code : 'E_MASQUERADE_UNAVAILABLE'
      )
      await this.recordControlOutcome({
        owner,
        row,
        kind: 'start_denied',
        outcomeCode: error instanceof MasqueradeError ? error.code : 'E_MASQUERADE_UNAVAILABLE',
        attempted,
      })
      throw error instanceof MasqueradeError ? error : createUnavailableError()
    }
  }
  async stop(request: Request, input: StopInput): Promise<ModeView> {
    const actor = await this.authenticateActor(request)
    const owner = this.buildOwnerKey(actor)
    let row: ModeRow | null = null
    let idleOutcomeAttempted = false
    try {
      // §6.4 Any: an unavailable store or malformed row is 503.
      row = await this.read(owner)
      // §7.3: stop accepts only the expected context.
      if (!input || Object.keys(input).some((key) => key !== 'expectedContext'))
        throw createInvalidInputError()
      // §7.3: a stale stop never clears a newer mode (§6.4 Any: mismatch is 409).
      requireContext(input.expectedContext, contextToken(owner, row))
      // §6.4 Any: a revision at Number.MAX_SAFE_INTEGER fails closed.
      nextRevision(row)
      // §6.4 Idle/absent: 200 idle, no revision change, one control_noop record.
      if (!row || row.state === 'idle') {
        idleOutcomeAttempted = true
        await this.recordControlOutcome({ owner, row, kind: 'control_noop', outcomeCode: 'idle' })
        return modeView(owner, row)
      }
      // I06: a lapsed mode is recorded as expired, as admission, prune and the CLI record it.
      if (this.readCurrentTimestamp() >= row.expiresAt)
        return modeView(owner, await this.clear(owner, row, 'expired', 'expired'))
      // §6.4 Active: idle with one stopped event; I08: no target load or policy call.
      return modeView(owner, await this.clear(owner, row, 'stopped', 'stopped'))
    } catch (error) {
      // I09: an indeterminate commit may have applied, so it records no denial.
      if (error instanceof UnknownCommit) throw error
      // A failed control_noop record is not also a denial.
      if (idleOutcomeAttempted) throw error
      // §6.4: every refused stop records one stop_denied outcome; I07: other errors are 503.
      reportDiagnostic(
        this.dependencies,
        'control',
        'stop',
        error instanceof MasqueradeError ? error.code : 'E_MASQUERADE_UNAVAILABLE'
      )
      await this.recordControlOutcome({
        owner,
        row,
        kind: 'stop_denied',
        outcomeCode: error instanceof MasqueradeError ? error.code : 'E_MASQUERADE_UNAVAILABLE',
      })
      throw error instanceof MasqueradeError ? error : createUnavailableError()
    }
  }
  /** §7.2 business admission through admit(), once per request (I10). */
  async resolve(request: Request): Promise<ResolvedContext> {
    const admitted = await this[admission](request)
    return admitted.context
  }
  async resolveView(request: Request): Promise<ModeView> {
    try {
      const admitted = await this[admission](request)
      return admitted.view
    } catch (error) {
      if (error instanceof MasqueradeError) {
        const view = this.#viewsAfterInvalidation.get(error)
        if (view) return view
      }
      throw error
    }
  }
  private async invalidateAdmission(
    owner: OwnerKey,
    row: ActiveModeRow,
    kind: 'expired' | 'invalidated',
    code: string
  ): Promise<never> {
    const idle = await this.clear(owner, row, kind, code)
    const error = new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED')
    this.#viewsAfterInvalidation.set(error, modeView(owner, idle))
    throw error
  }
  async [admission](request: Request): Promise<RequestAdmission<User>> {
    const memo = this.#admissionsByRequest.get(request)
    if (memo) return memo
    const pending = this.admit(request)
    this.#admissionsByRequest.set(request, pending)
    // A rejected request must never retry under the identity created by its own invalidation.
    return pending
  }
  private async admit(request: Request): Promise<RequestAdmission<User>> {
    const actor = await this.authenticateActor(request)
    const owner = this.buildOwnerKey(actor)
    // §7.2 step 1: read the owner row on every request; no cross-request allow cache.
    const row = await this.read(owner)
    // §6.4 Any: a revision at Number.MAX_SAFE_INTEGER fails closed.
    if (row?.revision === Number.MAX_SAFE_INTEGER) throw createUnavailableError()
    // §7.2 step 2: an idle request runs as the actor.
    let effective = actor
    if (row?.state === 'active') {
      let invalid: string | undefined
      // §7.2 step 3, I06: expiry is checked before any account read; the request gets 409.
      if (this.readCurrentTimestamp() >= row.expiresAt) {
        return this.invalidateAdmission(owner, row, 'expired', 'expired')
      }
      // §6.4 Active: an ineligible account, changed stamp or canMasquerade false invalidates.
      const currentActor = await this.inspect(actor.id)
      const target = await this.inspect(row.targetId)
      if (!this.eligibleActor(currentActor, actor)) invalid = 'actor_ineligible'
      else if (
        !target?.active ||
        target.subject.id !== row.targetId ||
        target.subject.incarnation !== row.targetIncarnation
      )
        invalid = 'target_ineligible'
      else {
        try {
          if (stampHash(currentActor.securityStamp) !== row.actorStampHash) invalid = 'actor_stamp'
          else if (stampHash(target.securityStamp) !== row.targetStampHash) invalid = 'target_stamp'
        } catch {
          reportDiagnostic(
            this.dependencies,
            'authority',
            'security_stamp',
            'E_MASQUERADE_UNAVAILABLE'
          )
          throw createUnavailableError()
        }
        if (
          !invalid &&
          !(await this.checkMasqueradePermission(currentActor.subject, target.subject))
        )
          invalid = 'policy_denied'
        // §14.1: an edit mode also needs canEdit true; it is never downgraded to view.
        if (
          !invalid &&
          row.access === 'edit' &&
          !(await this.checkEditPermission(currentActor.subject, target.subject))
        )
          invalid = 'edit_denied'
      }
      // §6.4 Active: CAS to idle with one invalidated event; the triggering request gets 409.
      if (invalid) {
        return this.invalidateAdmission(owner, row, 'invalidated', invalid)
      }
      effective = target!.subject
      // §6.4 Active: canUseRequest false rejects this request only; the mode is unchanged.
      await this.assertRequestPermission(currentActor!.subject, effective, request)
    }
    return buildAdmittedProjection(owner, row, actor, effective)
  }
}
