import { getNewsModuleMessages } from '@/lib/i18n/news-module-messages'

/**
 * The back link on a news article — label and fallback URL.
 *
 * Label: the site's own name for its news index (newsPage hero title, e.g.
 * "Journal") when authored — the button then reads "← Journal", which needs
 * no grammar per language. Without one, the module's localized "Back to News".
 *
 * URL: the news index under the site base (see siteBasePath()). A legacy
 * `?from=<page>` (listing cards no longer add it) still returns to that page.
 * The button navigates through browser history first; this URL is only the
 * fallback for a visitor who opened the article directly.
 */
export function newsBackLink(opts: {
  from: string | undefined
  locale: string
  siteBase: string
  newsIndexTitle?: string | null
}): { label: string; url: string } {
  const { from, locale, siteBase } = opts
  const msg = getNewsModuleMessages(locale)
  const title = opts.newsIndexTitle?.trim()

  if (!from || from === 'news') {
    return { label: title || msg.backToNews, url: `${siteBase}/news` }
  }
  return { label: msg.backToNews, url: `${siteBase}/${from}` }
}
