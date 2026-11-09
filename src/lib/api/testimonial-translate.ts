/**
 * Translate on Testimonial fields — the dashboard path of ADR-023 (ADR-048 D6).
 *
 * Mirrors `person-translate.ts`: same engine as POST /api/translate
 * (`runTranslate`), same provider/quota/metering, and the same rules.
 *
 *   1. `testimonials.write` on the GRANT (module installed, owner/editor).
 *   2. The Translate module is installed (enabled) for that project.
 *   3. The SOURCE TEXT is read from the saved testimonial, never from the
 *      browser. The editor flushes its autosave first.
 *   4. One click never overwrites `original` or `reviewed` text — only empty
 *      values or untouched `machine` ones (`isWritableTarget`).
 *
 * Nothing is written here: the editor saves the result through
 * `saveTestimonialDraft` (paths `<field>.<loc>` + `translation.<field>.<loc>`),
 * so the draft/revision discipline stays in one place and the stored status is
 * `machine`.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TESTIMONIAL_WRITE_PERMISSION, TestimonialError, isTestimonialId } from '@/lib/api/testimonials-lifecycle'
import { translationMetaOf } from '@/lib/api/testimonials'
import { defaultTranslateDeps, TRANSLATE_MODULE } from '@/lib/api/person-translate'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { loadTranslateConfig } from '@/lib/translate/config'
import { runTranslate, type TranslateDeps } from '@/lib/translate/service'
import { isWritableTarget, machineMeta, type TranslationMeta } from '@/lib/translate/status'
import { TranslateError, type TranslateUsageSummary } from '@/lib/translate/types'
import { validateTranslateRequest } from '@/lib/translate/validate'
import { TESTIMONIAL_LIMITS, TESTIMONIAL_LOCALIZED_FIELDS, TESTIMONIAL_TYPE, type TestimonialLocalizedField } from '@/lib/modules/testimonials/model'

export type TestimonialTranslateResult = {
  /** Per field, per target language: the text and the status to store beside it. */
  results: Partial<Record<TestimonialLocalizedField, Record<string, { text: string; meta: TranslationMeta }>>>
  /** Targets left alone: already written or reviewed by a person (or too long for the field). */
  skipped: Array<{ field: TestimonialLocalizedField; locale: string; reason: 'protected' | 'too_long' }>
  usage: TranslateUsageSummary | null
}

type Doc = Record<string, unknown> & { projectSlug?: string; _type?: string; archivedAt?: unknown }
export type TestimonialTranslateDeps = {
  getDocument?: (id: string) => Promise<Doc | undefined>
  translate?: Partial<TranslateDeps>
  now?: () => Date
}

const FIELD_MAX: Record<TestimonialLocalizedField, number> = {
  context: TESTIMONIAL_LIMITS.context,
  abstract: TESTIMONIAL_LIMITS.abstract,
  body: TESTIMONIAL_LIMITS.body,
}

/** Same cleaning as `cleanParagraphs` in testimonials.ts. */
function cleanParagraphsLike(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function translateTestimonialFields(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; fields: TestimonialLocalizedField[]; sourceLocale: string },
  deps: TestimonialTranslateDeps = {}
): Promise<TestimonialTranslateResult> {
  assertModuleAction(ctx, projectId, TESTIMONIAL_WRITE_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  if (!grant.enabledModuleIds.includes(TRANSLATE_MODULE)) throw new TranslateError('module_disabled', 'translate is not installed')
  if (!isTestimonialId(input?.id)) throw new TestimonialError('not_found', 'Unknown testimonial.')
  const fields = [...new Set(input.fields ?? [])]
  if (!fields.length || !fields.every((f) => (TESTIMONIAL_LOCALIZED_FIELDS as readonly string[]).includes(f))) throw new TranslateError('invalid_request', 'fields')

  const get = deps.getDocument ?? ((id: string) => sanityWriteClient.getDocument(id) as Promise<Doc | undefined>)
  const [draft, published] = await Promise.all([get(`drafts.${input.id}`), get(input.id)])
  for (const d of [draft, published]) if (d && (d._type !== TESTIMONIAL_TYPE || d.projectSlug !== grant.projectSlug)) throw new TestimonialError('not_found', 'Unknown testimonial.')
  const doc = draft ?? published
  if (!doc) throw new TestimonialError('not_found', 'Unknown testimonial.')
  if ((published ?? draft)?.archivedAt) throw new TestimonialError('archived', 'Restore this testimonial to edit it.')

  const config = await (deps.translate?.loadConfig ?? loadTranslateConfig)(grant.projectSlug)
  if (!config) throw new TranslateError('project_not_found', grant.projectSlug)
  if (!config.enabled) throw new TranslateError('module_disabled', grant.projectSlug)

  const out: TestimonialTranslateResult = { results: {}, skipped: [], usage: null }
  const now = deps.now?.() ?? new Date()
  const run = { ...defaultTranslateDeps(), ...deps.translate }
  let ranAny = false
  for (const field of fields) {
    const value = doc[field] as Record<string, unknown> | undefined
    const source = typeof value?.[input.sourceLocale] === 'string' ? (value[input.sourceLocale] as string).trim() : ''
    if (!source) continue
    const metas = translationMetaOf(value)
    const targets: string[] = []
    for (const loc of config.supportedLocales) {
      if (loc === input.sourceLocale) continue
      const current = typeof value?.[loc] === 'string' ? (value[loc] as string) : ''
      if (isWritableTarget(current, metas[loc])) targets.push(loc)
      else out.skipped.push({ field, locale: loc, reason: 'protected' })
    }
    if (!targets.length) continue
    const req = validateTranslateRequest({ projectSlug: grant.projectSlug, sourceLocale: input.sourceLocale, targetLocales: targets, texts: [source], format: 'text', documentId: input.id })
    const outcome = await runTranslate(req, ctx.userId, run)
    ranAny = true
    out.usage = outcome.usage
    for (const loc of req.targetLocales) {
      // Cleaned exactly like saveTestimonialDraft (line for context, paragraphs otherwise), so the stored hash matches the saved text.
      const raw = outcome.translations[loc]?.[0] ?? ''
      const text = field === 'context' ? raw.trim().replace(/\s+/g, ' ') : cleanParagraphsLike(raw)
      if (!text) continue
      if (text.length > FIELD_MAX[field]) {
        out.skipped.push({ field, locale: loc, reason: 'too_long' })
        continue
      }
      ;(out.results[field] ??= {})[loc] = { text, meta: machineMeta({ text, source, sourceLocale: input.sourceLocale, provider: outcome.provider, now }) }
    }
  }
  if (!ranAny && !out.skipped.length) throw new TranslateError('invalid_request', 'nothing to translate')
  return out
}
