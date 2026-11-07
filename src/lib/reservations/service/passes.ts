// ── Reservations — pass attendance: "I'm coming" / "I'm not coming" (D9) ──────
import { localOf } from '@/lib/scheduling/time'
import { canSignUp, canWithdraw, scopeCovers } from '../passes'
import { isWellFormedToken, hashToken } from '../tokens'
import type { Actor, PassRow } from '../server/types'
import { fromStoreError, loadRuleContext, refuse, sessionRules, succeed, type ServiceDeps, type ServiceResult, type SessionInfo, type TargetRef } from './types'

export type PassAttendanceInput = {
  projectId: string
  /** The My-pass token (participant) …  */
  passToken?: string
  /** … or a pass id (dashboard; the database still checks project, validity, scope, entries). */
  passId?: string
  occurrenceId: string
  session: SessionInfo
  target: TargetRef
  timeZone: string
  actor?: Actor
}

async function resolvePass(
  input: PassAttendanceInput, deps: ServiceDeps,
): Promise<ServiceResult<{ passId: string; pass: PassRow | null }>> {
  if (input.session.occurrenceId !== input.occurrenceId) return refuse('session_mismatch')
  if (input.passToken) {
    if (!isWellFormedToken(input.passToken)) return refuse('not_found')
    const r = await deps.store.getPassByTokenHash(hashToken(input.passToken))
    if (!r.ok) return fromStoreError(r.error)
    // Token lookups are not project-scoped: the caller's project must match.
    if (!r.value || r.value.projectId !== input.projectId) return refuse('not_found')
    return succeed({ passId: r.value.id, pass: r.value })
  }
  if (input.passId) return succeed({ passId: input.passId, pass: null })
  return refuse('not_found')
}

export async function signUp(input: PassAttendanceInput, deps: ServiceDeps): Promise<ServiceResult<{ allocationId: string; replayed: boolean }>> {
  const p = await resolvePass(input, deps)
  if (!p.ok) return p
  const { passId, pass } = p.value

  const ctx = await loadRuleContext(deps, input.projectId, input.target)
  if (!ctx.ok) return ctx
  const rules = sessionRules(ctx.value.rules, input.session)
  if (rules.passSignUp === 'off') return refuse('sign_up_not_needed')

  const state = canSignUp({
    now: deps.now(),
    sessionStartsAt: new Date(input.session.startsAt),
    opensDaysBefore: rules.signUpOpensDaysBefore,
    changeUntilHoursBefore: rules.answerChangeUntilHoursBefore,
  })
  if (state === 'not_open_yet') return refuse('sign_up_not_open_yet')
  if (state === 'closed') return refuse('sign_up_closed')

  if (pass) {
    if (pass.status !== 'active') return refuse('pass_not_active')
    const local = localOf(input.session.startsAt, input.timeZone).slice(0, 10)
    if (local < pass.validFrom || local > pass.validTo) return refuse('pass_does_not_cover')
    // 'target'-scoped passes depend on the target's owner: the database decides.
    if (pass.scope === 'all_courses' || pass.scope === 'courses') {
      const scope = pass.scope === 'all_courses' ? { kind: 'all_courses' as const } : { kind: 'courses' as const, ownerPublicIds: pass.scopeOwnerIds ?? [] }
      if (!scopeCovers(scope, input.session.ownerType, input.session.ownerPublicId)) return refuse('pass_does_not_cover')
    }
  }

  const r = await deps.store.passAttend(input.projectId, passId, input.occurrenceId, { actor: input.actor ?? { kind: 'participant' } })
  if (!r.ok) return fromStoreError(r.error)
  return succeed(r.value)
}

export async function withdraw(
  input: PassAttendanceInput, deps: ServiceDeps,
): Promise<ServiceResult<{ released: boolean; entryReturned: boolean; afterDeadline: boolean }>> {
  const p = await resolvePass(input, deps)
  if (!p.ok) return p
  const ctx = await loadRuleContext(deps, input.projectId, input.target)
  if (!ctx.ok) return ctx
  const rules = sessionRules(ctx.value.rules, input.session)
  const start = new Date(input.session.startsAt)
  if (deps.now().getTime() >= start.getTime()) return refuse('session_started')

  // The place is always given back; the ENTRY only before the change deadline (D9).
  const { entryReturned } = canWithdraw({ now: deps.now(), sessionStartsAt: start, changeUntilHoursBefore: rules.answerChangeUntilHoursBefore })
  const r = await deps.store.passWithdraw(input.projectId, p.value.passId, input.occurrenceId, {
    returnEntry: entryReturned, actor: input.actor ?? { kind: 'participant' },
  })
  if (!r.ok) return fromStoreError(r.error)
  return succeed({ released: r.value.released, entryReturned: r.value.entryReturned, afterDeadline: !entryReturned })
}
