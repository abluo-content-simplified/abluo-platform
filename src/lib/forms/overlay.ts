/**
 * Form overlay core — ADR-018 slice 7a.
 *
 * Pure, framework-free helpers for presenting a tenant-owned `formDefinition`
 * as an OVERLAY (modal) rather than an inline page section. The overlay reuses
 * the slice 4/5 renderers verbatim; this module only adds the lookup + routing
 * logic and the modal chrome copy, kept pure so it is unit-tested without
 * rendering.
 *
 * DESIGN
 * ──────
 * The provider is seeded server-side with a set of already-resolved overlay
 * forms (`OverlayFormEntry[]`), keyed by `formId`. A trigger anywhere in the
 * tree (a page button in 7b, a global nav CTA in 7c) opens the overlay by
 * `formId`; the host looks the definition up here and routes it to the single-
 * or multi-step renderer exactly as `FormSection` does inline. Resolving on the
 * server (not via a public client fetch) keeps definitions off an anonymous GET
 * and matches how the rest of the site already dereferences GROQ references.
 *
 * This module is deliberately independent of the bespoke Early Access overlay
 * (`EarlyAccessContext`/`EarlyAccessModal`), which stays exactly as-is. The two
 * never share state.
 */
import type { RenderableFormDefinition } from '@/lib/sanity/types'

/** A single overlay-openable form, pre-resolved on the server. */
export interface OverlayFormEntry {
  /** Stable definition id (matches `RenderableFormDefinition.formId`). */
  formId: string
  /** GROQ-resolved, locale-applied definition — fed straight to the renderers. */
  definition: RenderableFormDefinition
}

/** A request to open the overlay for a specific form. */
export interface OverlayOpenRequest {
  /** Which pre-resolved form to open. */
  formId: string
  /**
   * Optional placement Context — only `contextMappable` keys are honored
   * (client pre-fill + server authority), identical to a Form Section's
   * `section.context`. Passed through to the multi-step renderer.
   */
  context?: Record<string, unknown> | null
  /**
   * Optional overlay heading override. When omitted the host falls back to the
   * definition's own `title`. Lets a nav CTA label the panel independently of
   * the form's internal title.
   */
  title?: string | null
  /**
   * Optional lead-source seed (entry point + CTA attribution) merged into the
   * submission `source` alongside the auto-collected page/referrer/UTM. e.g.
   * `{ source: 'header_cta', cta_internal_name, cta_label_snapshot }`.
   */
  source?: Record<string, unknown> | null
}

/**
 * Resolves the pre-seeded entry for `formId`, or null when no such form was
 * provided to the overlay provider. Pure lookup — the host renders nothing on
 * null rather than throwing, so a stale trigger can never crash a page.
 */
export function selectOverlayForm(
  forms: readonly OverlayFormEntry[],
  formId: string,
): OverlayFormEntry | null {
  return forms.find((f) => f.formId === formId) ?? null
}

/**
 * Whether a definition should render through the multi-step flow. Mirrors
 * `FormSection` exactly (`steps.length > 1`) so overlay and inline placements
 * make the identical single-vs-multi decision for the same definition.
 */
export function isMultiStepDefinition(def: RenderableFormDefinition | null | undefined): boolean {
  return (def?.steps?.length ?? 0) > 1
}

// ─── Overlay chrome copy (localized) ────────────────────────────────────────
// Platform UI strings for the modal shell itself (not tenant content). The form
// body's own copy comes from the definition + getFormSectionMessages(); this is
// only the close affordance's accessible label.

export interface OverlayChromeMessages {
  /** Accessible label + tooltip for the modal close (X) button. */
  closeLabel: string
}

const CHROME: Record<string, OverlayChromeMessages> = {
  en: { closeLabel: 'Close' },
  it: { closeLabel: 'Chiudi' },
  de: { closeLabel: 'Schließen' },
  fr: { closeLabel: 'Fermer' },
  es: { closeLabel: 'Cerrar' },
  pt: { closeLabel: 'Fechar' },
  nl: { closeLabel: 'Sluiten' },
}

/** Localized modal chrome copy, falling back to English for unknown locales. */
export function getOverlayChromeMessages(locale: string): OverlayChromeMessages {
  return CHROME[locale] ?? CHROME.en
}
