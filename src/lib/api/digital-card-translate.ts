/**
 * Translate on a Digital Card — the dashboard path of ADR-023 for the card's
 * short description and its link labels (ADR-049 D8).
 *
 * Mirrors `testimonial-translate.ts`: same engine as POST /api/translate
 * (`runTranslate`), same provider / quota / metering.
 *
 *   1. `digital-cards.write` on the GRANT (module installed, owner/editor).
 *   2. The Translate module is installed (enabled) for that project.
 *   3. The SOURCE TEXT is read from the saved card, never from the browser;
 *      the editor flushes its autosave first.
 *   4. One click only fills EMPTY languages — a card stores no translation
 *      status, so anything already written is someone's text and is kept.
 *
 * Nothing is written here: the editor saves the result through
 * `saveDigitalCardDraft`, so the draft/revision discipline stays in one place.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { DIGITAL_CARD_WRITE_PERMISSION, DigitalCardError, isDigitalCardId } from '@/lib/api/digital-cards-lifecycle'
import { defaultTranslateDeps, TRANSLATE_MODULE } from '@/lib/api/person-translate'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { loadTranslateConfig } from '@/lib/translate/config'
import { runTranslate, type TranslateDeps } from '@/lib/translate/service'
import { TranslateError, type TranslateUsageSummary } from '@/lib/translate/types'
import { validateTranslateRequest } from '@/lib/translate/validate'
import { DIGITAL_CARD_LIMITS, DIGITAL_CARD_TYPE } from '@/lib/modules/digital-cards/model'

export type DigitalCardTranslateResult = {
  /** Target language → text, for the description. */
  description: Record<string, string>
  /** Link key → target language → label. */
  labels: Record<string, Record<string, string>>
  usage: TranslateUsageSummary | null
}

type Doc = Record<string, unknown> & { projectSlug?: string; _type?: string; archivedAt?: unknown }
export type DigitalCardTranslateDeps = {
  getDocument?: (id: string) => Promise<Doc | undefined>
  translate?: Partial<TranslateDeps>
}

const textAt = (value: unknown, loc: string): string => {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  return typeof o?.[loc] === 'string' ? (o[loc] as string).trim() : ''
}

export async function translateDigitalCard(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; sourceLocale: string },
  deps: DigitalCardTranslateDeps = {}
): Promise<DigitalCardTranslateResult> {
  assertModuleAction(ctx, projectId, DIGITAL_CARD_WRITE_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  if (!grant.enabledModuleIds.includes(TRANSLATE_MODULE)) throw new TranslateError('module_disabled', 'translate is not installed')
  if (!isDigitalCardId(input?.id)) throw new DigitalCardError('not_found', 'Unknown card.')

  const get = deps.getDocument ?? ((id: string) => sanityWriteClient.getDocument(id) as Promise<Doc | undefined>)
  const [draft, published] = await Promise.all([get(`drafts.${input.id}`), get(input.id)])
  for (const d of [draft, published]) if (d && (d._type !== DIGITAL_CARD_TYPE || d.projectSlug !== grant.projectSlug)) throw new DigitalCardError('not_found', 'Unknown card.')
  const doc = draft ?? published
  if (!doc) throw new DigitalCardError('not_found', 'Unknown card.')
  if ((published ?? draft)?.archivedAt) throw new DigitalCardError('archived', 'Restore this card to edit it.')

  const config = await (deps.translate?.loadConfig ?? loadTranslateConfig)(grant.projectSlug)
  if (!config) throw new TranslateError('project_not_found', grant.projectSlug)
  if (!config.enabled) throw new TranslateError('module_disabled', grant.projectSlug)

  // The texts to translate: the description and every label written in the source language.
  type Item = { kind: 'description' } | { kind: 'label'; key: string }
  const items: Item[] = []
  const texts: string[] = []
  const desc = textAt(doc.description, input.sourceLocale)
  if (desc) {
    items.push({ kind: 'description' })
    texts.push(desc)
  }
  const links = Array.isArray(doc.links) ? (doc.links as Array<Record<string, unknown>>) : []
  for (const l of links) {
    const key = typeof l?._key === 'string' ? l._key : ''
    const label = textAt(l?.label, input.sourceLocale)
    if (key && label) {
      items.push({ kind: 'label', key })
      texts.push(label)
    }
  }
  const targetOf = (item: Item, loc: string) =>
    item.kind === 'description' ? textAt(doc.description, loc) : textAt(links.find((l) => l?._key === item.key)?.label, loc)
  const targets = config.supportedLocales.filter((loc) => loc !== input.sourceLocale && items.some((it) => !targetOf(it, loc)))
  if (!items.length || !targets.length) throw new TranslateError('invalid_request', 'nothing to translate')

  const req = validateTranslateRequest({ projectSlug: grant.projectSlug, sourceLocale: input.sourceLocale, targetLocales: targets, texts, format: 'text', documentId: input.id })
  const outcome = await runTranslate(req, ctx.userId, { ...defaultTranslateDeps(), ...deps.translate })
  const out: DigitalCardTranslateResult = { description: {}, labels: {}, usage: outcome.usage }
  for (const loc of req.targetLocales) {
    items.forEach((item, i) => {
      if (targetOf(item, loc)) return // someone's text: kept
      const text = (outcome.translations[loc]?.[i] ?? '').trim().replace(/[ \t]+/g, ' ')
      if (!text) return
      if (item.kind === 'description') {
        if (text.length <= DIGITAL_CARD_LIMITS.description) out.description[loc] = text
      } else if (text.length <= DIGITAL_CARD_LIMITS.label) {
        ;(out.labels[item.key] ??= {})[loc] = text.replace(/\s+/g, ' ')
      }
    })
  }
  return out
}
