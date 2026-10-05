/**
 * Which wizard steps a post goes through, in order (ADR-025 spec "Steps").
 * Pure, so the order rules are unit-tested:
 *   • "type" happens in the Add-content sheet, before the draft exists.
 *   • "category" only when the site has categories configured.
 *   • "languages" only on sites with more than one language.
 *   • "promote" (S10) is not built yet; "done" is a screen, never a stored step.
 *   • "review" is the overview: once the first pass is over (the user reached
 *     "publish"), reopening a draft lands there; Edit opens one step and
 *     "Done" returns to it. `wizard.furthest` remembers how far the first pass got.
 */
// Type-only: post-drafts.ts is server code (Sanity write client) and must not
// reach the browser bundle. The order is mirrored here; a test pins the two.
import type { WizardStep } from '@/lib/api/post-drafts'

export const WIZARD_STEP_ORDER: readonly WizardStep[] = [
  'type',
  'category',
  'title',
  'story',
  'cover',
  'languages',
  'preview',
  'publish',
  'promote',
  'review',
  'done',
]

export type WizardFlowStep = Exclude<WizardStep, 'type' | 'promote'>

/** The first-pass steps for this site, in order (the overview "review" is not one of them). */
export function wizardSteps(site: { categories: unknown[]; languages: string[] }): WizardFlowStep[] {
  const steps: WizardFlowStep[] = []
  if (site.categories.length > 0) steps.push('category')
  steps.push('title', 'story', 'cover')
  if (site.languages.length > 1) steps.push('languages')
  steps.push('preview', 'publish', 'done')
  return steps
}

const rank = (s: WizardStep) => WIZARD_STEP_ORDER.indexOf(s)

/** The later of two steps in wizard order. */
export function laterStep(a: WizardStep, b: WizardStep): WizardStep {
  return rank(b) > rank(a) ? b : a
}

/** The first pass is over once the user has reached the publish step. */
export function firstPassDone(furthest: WizardStep): boolean {
  return rank(furthest) >= rank('publish')
}

/**
 * Where a draft resumes at a stored first-pass step: that step when this site
 * has it, otherwise the next one it does have ("type" → the first step).
 */
export function resumeStep(stored: WizardStep, steps: WizardFlowStep[]): WizardFlowStep {
  if (stored === 'done' || stored === 'promote' || stored === 'review') {
    return steps.includes('publish') ? 'publish' : steps[0]
  }
  if ((steps as string[]).includes(stored)) return stored as WizardFlowStep
  const from = rank(stored)
  for (const s of WIZARD_STEP_ORDER.slice(from + 1)) {
    if ((steps as string[]).includes(s)) return s as WizardFlowStep
  }
  return steps[0]
}

/**
 * Where "Continue" opens a draft: the overview once the first pass is over,
 * otherwise the furthest step reached (never behind the stored step).
 */
export function resumeTarget(
  position: { step: WizardStep; furthest?: WizardStep },
  steps: WizardFlowStep[]
): WizardFlowStep {
  const furthest = laterStep(position.step, position.furthest ?? position.step)
  if (firstPassDone(furthest)) return 'review'
  return resumeStep(furthest, steps)
}

type Content = {
  title: Record<string, string>
  subtitle?: Record<string, string>
  body: Record<string, unknown[]>
  categories?: string[]
  cover?: { alt: Record<string, string> } | null
}

/** True when Portable Text blocks contain any non-blank text. */
export function hasText(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false
  return blocks.some((b) => {
    const children = (b as { children?: unknown } | null)?.children
    return (
      Array.isArray(children) &&
      children.some((c) => typeof (c as { text?: unknown })?.text === 'string' && (c as { text: string }).text.trim() !== '')
    )
  })
}

/** A language is publishable when it has a title AND body text (D9). */
export function languageReady(draft: Content, locale: string): boolean {
  return Boolean(draft.title[locale]?.trim()) && hasText(draft.body[locale])
}

/** A cover is set but has no description in the site's main language. */
export function coverNeedsAlt(draft: Content, defaultLocale: string): boolean {
  return Boolean(draft.cover) && !draft.cover?.alt?.[defaultLocale]?.trim()
}

/** The minimum a step needs before "Next" / "Done" is enabled. */
export function canAdvance(step: WizardFlowStep, draft: Content, defaultLocale: string): boolean {
  if (step === 'title') return Boolean(draft.title[defaultLocale]?.trim())
  if (step === 'story') return hasText(draft.body[defaultLocale])
  if (step === 'cover') return !coverNeedsAlt(draft, defaultLocale)
  return true
}

/** What publishing needs: a title and text in the main language. */
export function canPublish(draft: Content, defaultLocale: string): boolean {
  return languageReady(draft, defaultLocale)
}

/** Steps shown as progress segments (everything except the final "done" screen). */
export function progressSteps(steps: WizardFlowStep[]): WizardFlowStep[] {
  return steps.filter((s) => s !== 'done')
}

// ── Overview ("review") ──────────────────────────────────────────────────────

export type SectionState = 'done' | 'missing' | 'optional'
export type OverviewSection = { id: 'category' | 'title' | 'story' | 'cover' | 'languages'; state: SectionState }

/** The overview's sections for this site, each with its state. */
export function overviewSections(
  draft: Content,
  site: { categories: unknown[]; languages: string[]; defaultLocale: string }
): OverviewSection[] {
  const d = site.defaultLocale
  const out: OverviewSection[] = []
  if (site.categories.length > 0) out.push({ id: 'category', state: draft.categories?.length ? 'done' : 'optional' })
  out.push({ id: 'title', state: draft.title[d]?.trim() ? 'done' : 'missing' })
  out.push({ id: 'story', state: hasText(draft.body[d]) ? 'done' : 'missing' })
  out.push({ id: 'cover', state: !draft.cover ? 'optional' : coverNeedsAlt(draft, d) ? 'missing' : 'done' })
  if (site.languages.length > 1) {
    const others = site.languages.filter((l) => l !== d)
    out.push({ id: 'languages', state: others.every((l) => languageReady(draft, l)) ? 'done' : 'optional' })
  }
  return out
}

// ── Publish summary (D9) ─────────────────────────────────────────────────────

export type LanguageState = 'ready' | 'partial' | 'empty'

/** Per language: ready (title + text), partial (something written) or empty. */
export function languageStates(draft: Content, languages: string[]): { locale: string; state: LanguageState }[] {
  return languages.map((locale) => ({
    locale,
    state: languageReady(draft, locale)
      ? 'ready'
      : draft.title[locale]?.trim() || draft.subtitle?.[locale]?.trim() || hasText(draft.body[locale])
        ? 'partial'
        : 'empty',
  }))
}

/**
 * The message key (under clientDashboard.create.publish) for one language in
 * the summary. Publishing (now / schedule) only says whether it goes live;
 * keeping a draft says what is saved.
 */
export function languageSummaryKey(state: LanguageState, mode: 'now' | 'schedule' | 'draft'): string {
  if (mode === 'draft') return state === 'ready' ? 'languageSaved' : state === 'partial' ? 'languageInProgress' : 'languageNotStarted'
  return state === 'ready' ? 'languageLive' : 'languageMissing'
}
