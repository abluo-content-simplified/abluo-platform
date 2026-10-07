/**
 * Invitation texts (email + acceptance page), from messages/{locale}.json →
 * `invitation`. Unknown locales fall back to English. All user-facing text
 * lives in the message files (multilingual-first).
 */
import en from '../../../messages/en.json'
import it from '../../../messages/it.json'
import de from '../../../messages/de.json'

export type InvitationMessages = typeof en.invitation

const BY_LOCALE: Record<string, InvitationMessages> = { en: en.invitation, it: it.invitation, de: de.invitation }

export function invitationLocale(locale: string | null | undefined): 'en' | 'it' | 'de' {
  return locale === 'it' || locale === 'de' ? locale : 'en'
}

export function getInvitationMessages(locale: string | null | undefined): InvitationMessages {
  return BY_LOCALE[invitationLocale(locale)]
}

/** `{name}` placeholders. Values are inserted verbatim — escape for HTML separately. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

export function roleLabel(m: InvitationMessages, role: string): string {
  return (m.roles as Record<string, string>)[role] ?? role
}

export function extrasLabel(m: InvitationMessages, extras: readonly string[]): string {
  return extras.map((id) => (m.extras as Record<string, string>)[id] ?? id).join(', ')
}
