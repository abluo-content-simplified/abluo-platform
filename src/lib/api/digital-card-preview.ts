/**
 * Client dashboard — the Digital Card editor's LIVE PREVIEW data (ADR-049
 * Amendment A, 2026-11-09).
 *
 * The editor renders the card with the website's own component
 * (DigitalCardView) from what is on screen. What the card shows besides the
 * card's own fields — Website Settings, the person's PUBLIC People fields, the
 * pages and files links point at, the chosen background with its focal point,
 * the design system — is read here, once per language / background / file set.
 *
 * Same enforcement as digital-cards.ts: digital-cards.read before any I/O,
 * the project from the GRANT, the card re-read and required to be this
 * project's; every read is scoped by $projectSlug. Read-only: nothing is
 * written, and nothing here reaches the website.
 *
 * The person is read even when hidden on the website (the preview shows what
 * the card WILL show; the editor says separately that the card redirects).
 * Never person_private.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { designSystemQuery } from '@/lib/sanity/queries'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import type { DesignSystem, MotionTokens } from '@/lib/sanity/types'
import { PERSON_PUBLIC_FIELDS, type PersonPublic } from '@/lib/modules/people/projection'
import { DIGITAL_CARD_TYPE } from '@/lib/modules/digital-cards/model'
import {
  DIGITAL_CARD_MEDIA_IMAGE_PROJECTION,
  DIGITAL_CARD_PUBLIC,
  DIGITAL_CARD_SITE_FIELDS,
  type DigitalCardImage,
  type DigitalCardProjectPublic,
  type DigitalCardSitePublic,
} from '@/lib/modules/digital-cards/projection'
import { cardPreviewTheme, type CardPreviewTheme, type CardPreviewThemeMode } from '@/lib/modules/digital-cards/preview-theme'
import { DIGITAL_CARD_READ_PERMISSION, DigitalCardError, isDigitalCardId } from '@/lib/api/digital-cards-lifecycle'

export interface DigitalCardPreviewPage {
  pageType?: string | null
  slug?: string | null
  title?: string | null
}

export interface DigitalCardPreviewFile {
  mediaType?: string | null
  url?: string | null
  title?: string | null
}

/** Everything the preview needs that is not one of the card's own fields. */
export interface DigitalCardPreviewBase {
  locale: string
  defaultLocale: string
  site: DigitalCardSitePublic | null
  project: DigitalCardProjectPublic | null
  /** Person card: PUBLIC People fields (also while the person is hidden). */
  person: PersonPublic | null
  /** The live site card's background (inherited by person cards without one). */
  siteCard: { background?: DigitalCardImage | null } | null
  pages: Record<string, DigitalCardPreviewPage>
  files: Record<string, DigitalCardPreviewFile>
  /** The background asked for, with its focal point. */
  background: DigitalCardImage | null
  theme: CardPreviewTheme
  motion: MotionTokens | null
}

type Reader = { fetch: <T>(query: string, params: Record<string, unknown>) => Promise<T>; getDocument: (id: string) => Promise<unknown> }
export type DigitalCardPreviewDeps = {
  client?: Reader
  designSystem?: (projectSlug: string) => Promise<DesignSystem | null>
}

const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const PUBLISHED = `!(_id in path("drafts.**"))`
const MAX_FILES = 30

/** One read: site, person, site card, pages, files, background, theme mode. Binds $projectSlug, $locale, $defaultLocale, $personId, $fileIds, $backgroundId. */
export const DIGITAL_CARD_PREVIEW_QUERY = /* groq */ `{
  ${DIGITAL_CARD_SITE_FIELDS},
  "person": *[_type == "person" && _id == $personId && projectSlug == $projectSlug && ${PUBLISHED}][0]{ ${PERSON_PUBLIC_FIELDS} },
  "siteCard": *[${DIGITAL_CARD_PUBLIC} && kind == "site"][0]{ "background": select(background->projectSlug == $projectSlug => background->${DIGITAL_CARD_MEDIA_IMAGE_PROJECTION}) },
  "pages": *[_type == "page" && projectSlug == $projectSlug && ${PUBLISHED}] | order(_createdAt asc)[0...300]{
    _id,
    pageType,
    "slug": coalesce(slug[$locale].current, slug[$defaultLocale].current),
    "title": coalesce(title[$locale], title[$defaultLocale], title.en, select(!defined(title._type) => title))
  },
  "files": *[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $fileIds]{
    _id,
    mediaType,
    "url": coalesce(image.asset->url, animation.asset->url, videoUrl),
    "title": coalesce(title[$locale], title[$defaultLocale], name)
  },
  "background": *[_type == "mediaAsset" && projectSlug == $projectSlug && _id == $backgroundId][0]${DIGITAL_CARD_MEDIA_IMAGE_PROJECTION},
  "themeMode": *[_type == "siteConfig" && projectSlug == $projectSlug && ${PUBLISHED}][0].themeMode
}`

type Row = {
  site?: DigitalCardSitePublic | null
  project?: DigitalCardProjectPublic | null
  person?: PersonPublic | null
  siteCard?: { background?: DigitalCardImage | null } | null
  pages?: Array<{ _id?: unknown } & DigitalCardPreviewPage> | null
  files?: Array<{ _id?: unknown } & DigitalCardPreviewFile> | null
  background?: DigitalCardImage | null
  themeMode?: unknown
}

const THEME_MODES: readonly CardPreviewThemeMode[] = ['lightOnly', 'darkOnly', 'toggle', 'system']

async function readDesignSystem(projectSlug: string, client: Reader): Promise<DesignSystem | null> {
  const raw = await client.fetch<DesignSystem | null>(designSystemQuery, { projectSlug })
  return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
}

/**
 * The preview data of one card in one language. `backgroundId` = the
 * background chosen on screen (null = none); `fileIds` = the files the links
 * on screen point at. The design system degrades to the platform defaults when
 * it cannot be read (the preview never fails because of it).
 */
export async function getDigitalCardPreview(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; locale: string; backgroundId?: string | null; fileIds?: readonly string[] },
  deps: DigitalCardPreviewDeps = {},
): Promise<DigitalCardPreviewBase> {
  assertModuleAction(ctx, projectId, DIGITAL_CARD_READ_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  const projectSlug = grant.projectSlug
  const client = deps.client ?? (sanityWriteClient as unknown as Reader)
  if (!input || !isDigitalCardId(input.id)) throw new DigitalCardError('not_found', 'Unknown card.')
  const locale = typeof input.locale === 'string' && LOCALE.test(input.locale) ? input.locale : null
  if (!locale) throw new DigitalCardError('invalid_value', 'Unknown language.')
  const backgroundId = typeof input.backgroundId === 'string' && DOC_ID.test(input.backgroundId) ? input.backgroundId : null
  const fileIds = [...new Set((Array.isArray(input.fileIds) ? input.fileIds : []).filter((f): f is string => typeof f === 'string' && DOC_ID.test(f)))].slice(0, MAX_FILES)

  // The card itself: this project's, in any state (draft first).
  const [draft, published] = (await Promise.all([client.getDocument(`drafts.${input.id}`), client.getDocument(input.id)])) as Array<Record<string, unknown> | undefined>
  const doc = draft ?? published
  const ours = (d: Record<string, unknown> | undefined) => !d || (d._type === DIGITAL_CARD_TYPE && d.projectSlug === projectSlug)
  if (!doc || !ours(draft) || !ours(published)) throw new DigitalCardError('not_found', 'Unknown card.')
  const personRef = doc.kind === 'person' ? (doc.person as { _ref?: unknown } | undefined)?._ref : null
  const personId = typeof personRef === 'string' && DOC_ID.test(personRef) ? personRef : null

  const languages = await client.fetch<{ defaultLocale?: unknown; supportedLocales?: unknown } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && ${PUBLISHED}][0]{ defaultLocale, supportedLocales }`,
    { projectSlug },
  )
  const defaultLocale = typeof languages?.defaultLocale === 'string' && languages.defaultLocale ? languages.defaultLocale : 'en'
  const supported = Array.isArray(languages?.supportedLocales) ? (languages!.supportedLocales as unknown[]).filter((l): l is string => typeof l === 'string') : []
  if (locale !== defaultLocale && !supported.includes(locale)) throw new DigitalCardError('invalid_value', 'Unknown language.')

  const [row, ds] = await Promise.all([
    client.fetch<Row | null>(DIGITAL_CARD_PREVIEW_QUERY, { projectSlug, locale, defaultLocale, personId, fileIds, backgroundId }),
    (deps.designSystem ?? ((slug: string) => readDesignSystem(slug, client)))(projectSlug).catch(() => null),
  ])
  const r = row ?? {}
  const pages: Record<string, DigitalCardPreviewPage> = {}
  for (const p of r.pages ?? []) if (typeof p?._id === 'string') pages[p._id] = { pageType: p.pageType ?? null, slug: p.slug ?? null, title: p.title ?? null }
  const files: Record<string, DigitalCardPreviewFile> = {}
  for (const f of r.files ?? []) if (typeof f?._id === 'string') files[f._id] = { mediaType: f.mediaType ?? null, url: f.url ?? null, title: f.title ?? null }
  const themeMode = (THEME_MODES as readonly unknown[]).includes(r.themeMode) ? (r.themeMode as CardPreviewThemeMode) : 'toggle'
  return {
    locale,
    defaultLocale,
    site: r.site ?? null,
    project: r.project ?? null,
    person: personId ? (r.person ?? null) : null,
    siteCard: r.siteCard ?? null,
    pages,
    files,
    background: backgroundId && r.background?.asset ? r.background : null,
    theme: cardPreviewTheme(ds, themeMode, input.id.replace(/[^A-Za-z0-9_-]/g, '')),
    motion: ds?.motion ?? null,
  }
}
