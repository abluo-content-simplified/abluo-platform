/**
 * German dashboard text uses the informal "du" everywhere (Tom, 2026-10-28):
 * the client dashboard, the admin, the editor and the emails they send.
 * Website text for visitors (sections, forms, consent, 404, Brand Hub) is out
 * of scope and not checked here.
 *
 * Fails on any capitalised "Sie" or "Ihr…/Ihnen" in the in-scope German text.
 * "Sie" meaning "they / it" is legitimate ("Sie bleiben unveröffentlicht"):
 * those sentences are listed below by key + the exact fragment, so a formal
 * "Sie" elsewhere in the same string still fails. Lower-case "sie/ihr" is
 * always third person and never flagged.
 */
import { describe, it, expect } from 'vitest'
import de from '../../../../messages/de.json'
import { getTranslateMessages } from '@/lib/i18n/translate-messages'
import { recipientNoticeEmail } from '@/lib/notifications/form-recipients-service'

/** Top-level sections of messages/de.json that are dashboard, admin or tenant-email text. */
const IN_SCOPE = ['account', 'clientDashboard', 'app', 'admin', 'editor', 'invitation', 'catalogue', 'supportTicketEmail'] as const

/** Third-person "Sie" (they / it), by key → the fragments that are allowed. */
const THIRD_PERSON: Record<string, string[]> = {
  'clientDashboard.posts.card.batch.done.archive': ['Sie sind nicht mehr'],
  'clientDashboard.posts.card.batch.done.restore': ['Sie bleiben unveröffentlicht'],
  'clientDashboard.events.editor.more.body': ['Sie bleiben beim Veröffentlichen'],
  'clientDashboard.events.editor.confirm.deleteBody': ['Sie wird endgültig entfernt'],
  'clientDashboard.home.attention.newRequestsWaiting.detail': ['Sie kam vor'],
  'clientDashboard.gallery.post.helper': ['Sie wird unter deinem Text'],
  'clientDashboard.taxonomy.category.confirmBody': ['Sie wird endgültig entfernt'],
  'clientDashboard.photoBatch.describe.replaces': ['Sie wird ersetzt', 'Sie werden ersetzt'],
  'clientDashboard.connections.intro': ['Sie können lesen, nie ändern'],
  'clientDashboard.connections.notice.awaitingApp': ['Sie beginnt zu lesen'],
  'clientDashboard.internalTags.media.note': ['Sie helfen dir'],
  'clientDashboard.internalTags.galleries.note': ['Sie helfen dir'],
  'clientDashboard.faq.post.publish.help': ['Sie gehen zusammen'],
  'clientDashboard.supportTickets.ticket.closedBody': ['Sie wurde vor einiger Zeit'],
  'clientDashboard.access.share.body': ['Sie geben es einmal'],
  'clientDashboard.access.groups.changeWarningCount': ['Sie werden abgemeldet'],
  'app.lifecycle.deletePermanently.body': ['Sie werden zusammen'],
  'catalogue.dashboard.item.editor.type.warnBookDetails': ['Sie kommen zurück'],
  'catalogue.dashboard.collection.sections.broken': ['Sie stehen oben'],
}

const FORMAL = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)\b/

function strings(node: unknown, path: string, out: Array<[string, string]>) {
  if (typeof node === 'string') out.push([path, node])
  else if (Array.isArray(node)) node.forEach((v, i) => strings(v, `${path}.${i}`, out))
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) strings(v, path ? `${path}.${k}` : k, out)
}

function formalIn(entries: Array<[string, string]>): string[] {
  const found: string[] = []
  for (const [key, text] of entries) {
    let rest = text
    for (const fragment of THIRD_PERSON[key] ?? []) rest = rest.split(fragment).join('')
    if (FORMAL.test(rest)) found.push(`${key}: ${text}`)
  }
  return found
}

const dashboard: Array<[string, string]> = []
for (const section of IN_SCOPE) strings((de as Record<string, unknown>)[section], section, dashboard)

describe('German dashboard text uses "du"', () => {
  it('messages/de.json — no formal "Sie/Ihr/Ihnen" in dashboard, admin, editor or email text', () => {
    expect(formalIn(dashboard)).toEqual([])
  })

  it('every third-person exception still exists (no stale allowlist)', () => {
    const byKey = new Map(dashboard)
    for (const [key, fragments] of Object.entries(THIRD_PERSON)) {
      for (const f of fragments) expect(byKey.get(key) ?? '', key).toContain(f)
    }
  })

  it('the Translate button (German)', () => {
    const out: Array<[string, string]> = []
    strings(getTranslateMessages('de'), 'translate', out)
    expect(formalIn(out)).toEqual([])
  })

  it('the "you will now receive form messages" email (German)', () => {
    for (const formLabel of ['Kontakt', null]) {
      const mail = recipientNoticeEmail({ siteName: 'Studio', formLabel, locale: 'de' })
      expect(formalIn([['subject', mail.subject], ['text', mail.text]])).toEqual([])
    }
  })

  it('the check itself catches formal address', () => {
    expect(formalIn([['x', 'Bitte versuchen Sie es erneut.']])).toHaveLength(1)
    expect(formalIn([['x', 'Ihre Änderungen sind gespeichert.']])).toHaveLength(1)
    expect(formalIn([['x', 'Wenn du sie entfernst, sind sie weg.']])).toHaveLength(0)
  })
})
