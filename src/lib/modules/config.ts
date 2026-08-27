// ── Runtime module configuration accessors ────────────────────────────────────
// ADR-020 Decision 2.
//
// One place where the website runtime reads module-owned settings, so that
// consumers never dig into `moduleInstallations[]` by hand and never re-derive
// the enabled/disabled rule.
//
// Isolation: this file is pure data shaping over the result of
// projectModuleConfigQuery. It imports no Sanity Studio code and no React, so
// it is safe in server components, route handlers, and tests alike.
//
// ── The siteConfig fallback, and why it exists ────────────────────────────────
//
// ADR-020 says communications config lives on the module, and it does: module
// config is read FIRST and always wins. The fallback to the legacy siteConfig
// fields exists because the Sanity dataset is shared across dev, preview, and
// production. Between merging this change and promoting `main`, production
// still runs code that reads siteConfig. If the fields were removed — or simply
// stopped being read — in one step, a live site would silently lose its WhatsApp
// button or header CTA for the length of the promotion pipeline.
//
// So the resolution order is deliberate and temporary:
//   1. module config  — the ADR-020 source of truth
//   2. siteConfig     — legacy, deprecated, removal deferred
//
// Removing step 2 is a follow-up commit, taken after production has been
// promoted and observed healthy. The siteConfig fields are already marked
// deprecated in the schema and hidden from the Studio form, so nothing new can
// be authored into them in the meantime.

import type { RenderableFormDefinition, WebsiteSiteConfig } from '@/lib/sanity/types'

// ── Query result shape ────────────────────────────────────────────────────────

/** One enabled installation as returned by projectModuleConfigQuery. */
export type ModuleConfigRecord = {
  moduleId: string
  version?: string
  config?: Record<string, unknown> | null
}

/** The full result of projectModuleConfigQuery — null when the project is absent. */
export type ProjectModuleConfig = ModuleConfigRecord[] | null | undefined

// ── Resolved shapes ───────────────────────────────────────────────────────────

/**
 * How the WhatsApp buttons behave when tapped (ADR-020 Amendment A).
 *
 * direct  — open WhatsApp immediately. Nothing is recorded.
 * capture — collect a subject and message first, record the enquiry, then hand
 *           off to WhatsApp pre-filled.
 */
export type WhatsAppMode = 'direct' | 'capture'

export type WhatsAppConfig = {
  number?: string
  /**
   * The module-owned form backing capture mode. Always null in direct mode —
   * there is nothing to open.
   */
  form: RenderableFormDefinition | null
  mode: WhatsAppMode
  /** Floating button, bottom-right, on every page. */
  floating: boolean
  /** Button beside the message button in Contact sections. */
  inContactSections: boolean
}

export type HeaderCtaConfig = {
  form: RenderableFormDefinition | null
  internalName?: string
  /** Button text, already locale-resolved by GROQ. */
  label?: string
  /** Destination when the button is a plain link rather than a form trigger. */
  href?: string
  /** Whether the button opens a form, navigates, or is absent. */
  mode: 'form' | 'link' | 'none'
}

// ── Primitive accessor ────────────────────────────────────────────────────────

/**
 * Returns the config object of one enabled module, or null.
 *
 * `null` covers three cases that are all "this module has nothing to say here":
 * the module is not installed, it is installed but disabled (the query already
 * filters those out), or it is enabled with no config set.
 */
export function getModuleConfig(
  modules: ProjectModuleConfig,
  moduleId: string
): Record<string, unknown> | null {
  if (!modules) return null
  const record = modules.find((m) => m.moduleId === moduleId)
  return record?.config ?? null
}

/** True when the module is installed and enabled for this website. */
export function isModuleEnabled(modules: ProjectModuleConfig, moduleId: string): boolean {
  if (!modules) return false
  return modules.some((m) => m.moduleId === moduleId)
}

/**
 * The website's enabled module IDs, for section gating.
 *
 * Preserves the null/[] distinction that isSectionTypeAvailable() depends on:
 *
 *   null / undefined → the module set could not be resolved (fetch failed, no
 *     project document). Gating FAILS OPEN, so a transient problem never blanks
 *     a tenant's existing sections.
 *   []               → resolved, and this website genuinely has no modules
 *     enabled. Gating applies.
 *
 * Collapsing those two into `[]` would turn a failed fetch into "hide every
 * module section", which is the worse failure mode — see the safe-default
 * contract documented on isSectionTypeAvailable in ./sections.ts.
 *
 * Exists so a page can issue ONE query (projectModuleConfigQuery) and satisfy
 * both section gating and module configuration, rather than fetching the same
 * installation array twice through two projections.
 */
export function getEnabledModuleIds(modules: ProjectModuleConfig): string[] | null {
  if (!modules) return null
  return modules.map((m) => m.moduleId)
}

// ── Typed readers ─────────────────────────────────────────────────────────────

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function asForm(value: unknown): RenderableFormDefinition | null {
  // A dereferenced form; anything without a formId cannot be rendered or
  // submitted, so it is treated as absent rather than passed downstream.
  if (!value || typeof value !== 'object') return null
  const candidate = value as RenderableFormDefinition
  return candidate.formId ? candidate : null
}

/**
 * Resolves WhatsApp configuration for a website.
 *
 * Module config wins; siteConfig is the deprecated fallback (see the file
 * header). The fallback is all-or-nothing per field rather than per source:
 * a site part-way through migration should still work, and mixing a module
 * number with a legacy form is a valid intermediate state.
 */
export function resolveWhatsAppConfig(
  modules: ProjectModuleConfig,
  siteConfig: WebsiteSiteConfig | null | undefined
): WhatsAppConfig {
  const config = getModuleConfig(modules, 'whatsapp')

  // Default to capture: it is what every existing site does today, so a config
  // written before the mode field existed must keep behaving the same way.
  const mode: WhatsAppMode = config?.mode === 'direct' ? 'direct' : 'capture'

  // `internalFormRef` is the module-owned form (ADR-020 Amendment A);
  // `whatsappForm` is the v1 field, kept readable so a site saved before the
  // rename keeps working until it is next saved.
  const moduleForm = asForm(config?.internalFormRef) ?? asForm(config?.whatsappForm)

  return {
    number: asString(config?.whatsappNumber) ?? asString(siteConfig?.whatsappNumber),
    // In direct mode there is deliberately no form, even if one is configured —
    // the mode is the admin's stated intent and the form is just leftover state.
    form: mode === 'capture' ? moduleForm ?? asForm(siteConfig?.whatsappForm) : null,
    mode,
    // A boolean has no "empty" value, so the module's `false` must be
    // distinguishable from "unset" — otherwise turning a button OFF in the
    // module would silently fall through to a legacy `true`.
    floating:
      typeof config?.whatsappFloating === 'boolean'
        ? config.whatsappFloating
        : siteConfig?.whatsappFloating === true,
    // No legacy fallback: this placement used to be a per-section checkbox, not
    // a site setting, so there is no site-level predecessor to inherit from.
    inContactSections: config?.showInContactSections === true,
  }
}

/**
 * Resolves the header CTA form for a website.
 * Module config wins; siteConfig is the deprecated fallback.
 *
 * Note this covers only the FORM. The CTA's label and plain-link URL stay on
 * siteConfig: they are navigation properties of the website, not form config
 * (ADR-020 Decision 2).
 */
export function resolveHeaderCtaConfig(
  modules: ProjectModuleConfig,
  siteConfig: WebsiteSiteConfig | null | undefined
): HeaderCtaConfig {
  const cta = (siteConfig as { headerCta?: Record<string, unknown> } | null | undefined)?.headerCta

  // The header button is configured in Website Settings → Navigation. It used
  // to live in Forms module config, and before that in standalone siteConfig
  // fields; both surfaces are gone now that every tenant is on this one.
  const form = asForm(cta?.form)
  const internalName = asString(cta?.internalName)

  // ctaLabel / ctaHref predate the cta object and still carry some tenants'
  // button text, so they remain as a label-only fallback.
  const label = asString(cta?.label) ?? asString(siteConfig?.ctaLabel)

  const actionType = asString(cta?.actionType)
  const href =
    (actionType === 'externalUrl' ? asString(cta?.externalUrl) : undefined) ??
    (actionType === 'page' ? asString(cta?.pageSlug) : undefined) ??
    (actionType === 'fileDownload' ? asString(cta?.fileUrl) : undefined) ??
    asString(siteConfig?.ctaHref)

  const mode: HeaderCtaConfig['mode'] = form ? 'form' : href ? 'link' : 'none'

  return { form, internalName, label, href, mode }
}
