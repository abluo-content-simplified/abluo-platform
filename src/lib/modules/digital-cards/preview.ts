// ── Digital Cards — the editor's live preview view model (Amendment A) ────────
//
// Pure and browser-safe. Turns what is ON SCREEN in the editor (description,
// links, background, switches) plus the preview data read for one language
// (DigitalCardPreviewBase: site, person, pages, files, background) into the
// SAME CardView the website renders — through siteCardView / personCardView,
// so what the editor shows is what visitors see. Hidden links are left out
// like the public projection does; texts fall back to the default language
// like loc() does on the website.

import type { DigitalCardPreviewBase } from '@/lib/api/digital-card-preview'
import type { DigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import type { PersonPublic } from '@/lib/modules/people/projection'
import type { DigitalCardKind, DigitalCardLinkKind } from './model'
import type { DigitalCardLinkPublic, DigitalCardPersonResult, DigitalCardShowRaw, DigitalCardSiteResult } from './projection'
import { personCardView, siteCardView, type CardView } from './website'

/** What the editor holds (structurally the dashboard's DigitalCardLinkValue). */
export interface PreviewLinkValue {
  key: string
  kind: DigitalCardLinkKind
  label: Record<string, string>
  description: Record<string, string>
  url: string
  page: string | null
  /** kind page (Amendment B): a built-in section / a module page instead of a page reference. */
  internalPage?: string | null
  moduleId?: string | null
  file: string | null
  logo: string | null
  value: string
  hidden: boolean
  primary: boolean
}

export interface PreviewValues {
  description: Record<string, string>
  links: readonly PreviewLinkValue[]
  /** The chosen background (asset id) — its image comes from the base. */
  backgroundId: string | null
  show: unknown
  urlName: string
}

const pick = (v: Record<string, string> | undefined, locale: string, fallback: string): string | null => {
  const own = v?.[locale]?.trim()
  if (own) return own
  const def = v?.[fallback]?.trim()
  return def || null
}

/** One editor link → the public projection of it (null target when it does not resolve). */
export function previewLink(l: PreviewLinkValue, base: DigitalCardPreviewBase): DigitalCardLinkPublic {
  const target = l.kind === 'page' || l.kind === 'form' || l.kind === 'booking' ? (l.page ? base.pages[l.page] ?? null : null) : null
  // Amendment B — a page link may also point at a catalogue target, a section or a module page.
  const pageLink =
    l.kind === 'page'
      ? {
          hasPageRef: Boolean(l.page),
          catalogue: l.page ? base.catalogue?.[l.page] ?? null : null,
          internalPage: l.page ? null : l.internalPage || null,
          moduleId: l.page || l.internalPage ? null : l.moduleId || null,
        }
      : {}
  return {
    ...pageLink,
    _key: l.key,
    kind: l.kind,
    label: pick(l.label, base.locale, base.defaultLocale),
    description: pick(l.description, base.locale, base.defaultLocale),
    primary: l.primary === true,
    url: l.kind === 'url' ? l.url : null,
    value: l.kind === 'phone' || l.kind === 'email' || l.kind === 'whatsapp' ? l.value : null,
    page: target,
    file: l.kind === 'file' && l.file ? base.files[l.file] ?? null : null,
    logo: l.logo ? base.files[l.logo]?.logo ?? null : null,
  }
}

/**
 * The card as the website would render it now. null for a person card whose
 * person cannot be read (deleted) — the editor says so instead.
 */
export function previewCardView(
  kind: DigitalCardKind,
  publicId: string,
  values: PreviewValues,
  base: DigitalCardPreviewBase,
  messages: DigitalCardSiteMessages,
): CardView | null {
  const common = {
    publicId: publicId || 'preview',
    description: pick(values.description, base.locale, base.defaultLocale),
    links: values.links.filter((l) => !l.hidden).map((l) => previewLink(l, base)),
    background: values.backgroundId ? base.background : null,
    show: values.show as DigitalCardShowRaw,
    site: base.site,
    project: base.project ?? { enabledModules: [] },
  }
  const ctx = { locale: base.locale, siteBase: '', messages }
  if (kind === 'site') return siteCardView({ ...common, kind: 'site' } as DigitalCardSiteResult, ctx)
  if (!base.person) return null
  const card: DigitalCardPersonResult & { person: PersonPublic } = {
    ...common,
    kind: 'person',
    urlName: values.urlName || 'preview',
    person: base.person,
    siteCard: base.siteCard,
  }
  return personCardView(card, ctx)
}
