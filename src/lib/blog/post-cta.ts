/**
 * Calls to action at the end of blog posts.
 *
 * Abluo owns the structure, clients choose: the site's prepared CTAs are
 * project-scoped `callToAction` documents (Studio → <project> → Website
 * Settings → Calls to action), at most one of them marked default. Each post
 * stores only its choice, `post.cta = { mode: 'default' | 'none' | 'custom',
 * ref? }` — `ref` a weak reference to a callToAction (absent = 'default').
 *
 * Pure and framework-free: used by the Studio validation (schema.ts), the
 * dashboard write path (post-drafts.ts) and the website
 * (components/blog/PostCallToAction.tsx), and unit-tested on its own.
 */
import { buildWhatsAppLink, hasWhatsAppNumber } from '@/lib/forms/whatsapp'

export const POST_CTA_ACTIONS = ['page', 'post', 'form', 'phone', 'whatsapp', 'email', 'externalUrl'] as const
export type PostCtaAction = (typeof POST_CTA_ACTIONS)[number]

export const POST_CTA_MODES = ['default', 'none', 'custom'] as const
export type PostCtaMode = (typeof POST_CTA_MODES)[number]

/** A post's stored choice. `ref` is the weak reference to the chosen callToAction. */
export type PostCtaChoice =
  | { mode?: PostCtaMode | string | null; ref?: { _ref?: string | null } | null }
  | null
  | undefined

/** The referenced callToAction id of a choice (published id, never `drafts.`). */
export function ctaRefId(choice: PostCtaChoice): string | null {
  const id = choice?.ref?._ref
  return typeof id === 'string' && id ? id.replace(/^drafts\./, '') : null
}

type Localized = Record<string, unknown> | null | undefined
type LocalizedSlug = Record<string, { current?: string | null } | unknown> | null | undefined

/** One prepared CTA as projected by `postCallToActionsQuery` (raw localized fields). */
export type SiteCallToAction = {
  _id?: string | null
  internalName?: string | null
  isDefault?: boolean | null
  heading?: Localized
  text?: Localized
  buttonLabel?: Localized
  actionType?: string | null
  /** Project-scoped slug object of the referenced page / post (null when foreign or missing). */
  pageSlugs?: LocalizedSlug
  postSlugs?: LocalizedSlug
  /** Project-scoped, locale-resolved form definition (overlay). */
  form?: ({ formId?: string | null } & Record<string, unknown>) | null
  phone?: string | null
  whatsappNumber?: string | null
  whatsappText?: Localized
  email?: string | null
  externalUrl?: string | null
}

export type PostCtaTarget =
  /** `internal`: a site path BELOW `/{locale}` (the caller adds the locale/tenant prefix). */
  | { kind: 'link'; href: string; internal: boolean; external: boolean }
  | { kind: 'form'; formId: string }

export type ResolvedPostCta = {
  /** The callToAction document id. */
  id: string
  internalName: string
  heading: string
  text: string | null
  buttonLabel: string
  target: PostCtaTarget
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/
const PHONE = /^\+?[0-9][0-9 ()./-]{4,24}$/

function text(value: Localized, locale: string): string | null {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>)[locale] : undefined
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function slugIn(value: LocalizedSlug, locale: string): string | null {
  const v = value && typeof value === 'object' ? (value as Record<string, { current?: unknown }>)[locale] : undefined
  const cur = v && typeof v === 'object' ? v.current : undefined
  return typeof cur === 'string' && cur ? cur : null
}

/** `tel:` href from a human-typed number ("+39 0541 123 456" → "tel:+390541123456"). */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone || !PHONE.test(phone.trim())) return null
  const t = phone.trim()
  return `tel:${t.startsWith('+') ? '+' : ''}${t.replace(/[^\d]/g, '')}`
}

export function mailtoHref(email: string | null | undefined): string | null {
  if (!email || !EMAIL.test(email.trim())) return null
  return `mailto:${email.trim()}`
}

function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * Where the button goes, in `locale` — or null when the target can't be
 * resolved in that language (a page / post without a slug there, a bad number).
 */
export function ctaActionTarget(cta: SiteCallToAction, locale: string): PostCtaTarget | null {
  switch (cta.actionType) {
    case 'page': {
      const slug = slugIn(cta.pageSlugs, locale)
      return slug ? { kind: 'link', href: `/${slug.replace(/^\/+/, '')}`, internal: true, external: false } : null
    }
    case 'post': {
      const slug = slugIn(cta.postSlugs, locale)
      return slug ? { kind: 'link', href: `/blog/${slug}`, internal: true, external: false } : null
    }
    case 'form': {
      const formId = cta.form?.formId
      return typeof formId === 'string' && formId ? { kind: 'form', formId } : null
    }
    case 'phone': {
      const href = telHref(cta.phone)
      return href ? { kind: 'link', href, internal: false, external: false } : null
    }
    case 'whatsapp':
      return hasWhatsAppNumber(cta.whatsappNumber)
        ? { kind: 'link', href: buildWhatsAppLink(cta.whatsappNumber, text(cta.whatsappText, locale)), internal: false, external: true }
        : null
    case 'email': {
      const href = mailtoHref(cta.email)
      return href ? { kind: 'link', href, internal: false, external: false } : null
    }
    case 'externalUrl': {
      const href = safeExternalUrl(cta.externalUrl)
      return href ? { kind: 'link', href, internal: false, external: true } : null
    }
    default:
      return null
  }
}

/** Which prepared CTA a post's choice points at (before any language check). */
export function selectPostCta(choice: PostCtaChoice, siteCtas: SiteCallToAction[] | null | undefined): SiteCallToAction | null {
  const list = (siteCtas ?? []).filter((c): c is SiteCallToAction => Boolean(c?._id))
  const mode = choice?.mode ?? 'default'
  if (mode === 'none') return null
  if (mode === 'custom') {
    const id = ctaRefId(choice)
    return list.find((c) => c._id === id) ?? null
  }
  return list.find((c) => c.isDefault === true) ?? null
}

/**
 * The CTA to show under a post in `locale`, or null. No language fallback: a
 * CTA without a heading AND a button label in this language — or whose target
 * doesn't resolve here — renders nothing.
 */
export function resolvePostCta(
  post: { cta?: PostCtaChoice } | null | undefined,
  siteCtas: SiteCallToAction[] | null | undefined,
  locale: string
): ResolvedPostCta | null {
  const cta = selectPostCta(post?.cta, siteCtas)
  if (!cta?._id) return null
  const heading = text(cta.heading, locale)
  const buttonLabel = text(cta.buttonLabel, locale)
  if (!heading || !buttonLabel) return null
  const target = ctaActionTarget(cta, locale)
  if (!target) return null
  return {
    id: cta._id,
    internalName: cta.internalName ?? cta._id,
    heading,
    text: text(cta.text, locale),
    buttonLabel,
    target,
  }
}

// ── Studio validation (schema.ts) ────────────────────────────────────────────

type Ref = { _ref?: string } | null | undefined
export type CtaEntryInput = {
  actionType?: string | null
  pageRef?: Ref
  postRef?: Ref
  formRef?: Ref
  phone?: string | null
  whatsappNumber?: string | null
  email?: string | null
  externalUrl?: string | null
}

/** Per-action validation for one prepared CTA. True, or the message to show. */
export function validateCtaAction(entry: CtaEntryInput | null | undefined): true | string {
  switch (entry?.actionType) {
    case 'page':
      return entry.pageRef?._ref ? true : 'Pick the page the button opens.'
    case 'post':
      return entry.postRef?._ref ? true : 'Pick the post the button opens.'
    case 'form':
      return entry.formRef?._ref ? true : 'Pick the form the button opens.'
    case 'phone':
      return telHref(entry.phone) ? true : 'Enter a phone number, e.g. +39 0541 123456.'
    case 'whatsapp':
      return hasWhatsAppNumber(entry.whatsappNumber) ? true : 'Enter the WhatsApp number with country code, e.g. +39 333 1234567.'
    case 'email':
      return mailtoHref(entry.email) ? true : 'Enter a valid email address.'
    case 'externalUrl':
      return safeExternalUrl(entry.externalUrl) ? true : 'Enter a full https:// address.'
    default:
      return 'Choose what the button does.'
  }
}
