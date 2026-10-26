/**
 * Site Access — which message the password prompt shows (ADR-040 B2.3). Pure.
 *
 * The outcome carried back by the routes (`?access=…`) wins; otherwise the
 * gate's view of the VISITOR (never of the page) decides. Every message is
 * about the visitor's own attempt or session.
 */
import type { PageGate } from './page-gate'
import type { AccessNotice } from './request'
import { formatAccessMessage, type AccessMessages } from '@/lib/i18n/access-messages'

export type PromptNoticeKind = AccessNotice | 'ended' | 'other_groups'
/** `invalid`: the typed password itself was wrong (marks the field), not a wait or an outage. */
export type PromptNotice = { kind: PromptNoticeKind; tone: 'error' | 'info'; text: string; invalid?: boolean }

export function promptNoticeKind(
  fromRoute: AccessNotice | null,
  gate: Extract<PageGate, { kind: 'denied' }> | null
): PromptNoticeKind | null {
  if (fromRoute) return fromRoute
  if (gate?.visitor === 'ended') return 'ended'
  if (gate?.visitor === 'other_groups') return 'other_groups'
  return null
}

export function promptNotice(kind: PromptNoticeKind | null, m: AccessMessages, waitMinutes: number | null): PromptNotice | null {
  switch (kind) {
    case 'wrong':
      return { kind, tone: 'error', text: m.wrongPassword, invalid: true }
    case 'wait':
      return {
        kind,
        tone: 'error',
        text: waitMinutes ? `${m.tooManyAttempts} ${formatAccessMessage(m.tryAgainIn, { minutes: waitMinutes })}` : m.tooManyAttempts,
      }
    case 'unavailable':
      return { kind, tone: 'error', text: m.unavailable }
    case 'ended':
      return { kind, tone: 'info', text: m.sessionEnded }
    case 'other_groups':
      return { kind, tone: 'info', text: m.otherGroups }
    case 'signed_out':
      return { kind, tone: 'info', text: m.signedOut }
    case 'signed_out_browser':
      return { kind, tone: 'info', text: m.signedOutBrowser }
    default:
      return null
  }
}
