import type { FilterablePost } from '@/lib/client/posts-filter'

/** One site language's translation state for a post: complete = title + body present. */
export type LanguageState = { code: string; complete: boolean }

/** A Posts list row. Dates are raw ISO; the browser formats them in the viewer's time zone. */
export type BrowserPost = FilterablePost & {
  title: string
  subtitle: string | null
  categories: string[]
  /** Go-live date (ISO): the publish date, or the scheduled date. Null for drafts. */
  publishedAt: string | null
  expiresAt: string | null
  featured: boolean
  /** One entry per site language; empty on single-language sites. */
  languageStates: LanguageState[]
  /** Locale-agnostic link to the post's overview (wizard drafts open in the wizard). */
  href?: string | null
  /** A live post with a draft: "Unpublished changes". */
  badge?: string | null
  /** Small square cover around the focal point, or null. */
  thumb?: string | null
  /** 16:10 cover around the focal point (desktop cards), or null. */
  cardImage?: string | null
  /** A published version exists (live, scheduled or offline). */
  hasLive?: boolean
  /** A draft exists (never published, or unpublished changes). */
  hasDraft?: boolean
  /** The live post on the website, when it is live and the site has a domain. */
  liveUrl?: string | null
  /** Site language to preview the draft in. */
  previewLocale?: string
}
