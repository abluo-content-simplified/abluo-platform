import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import '../globals.css'
import { routing } from '@/i18n/routing'
import type { SupportedLocale } from '@/lib/i18n/locales'
import { RootDocument } from '@/components/RootDocument'
import { assertLocaleEstablished } from '@/lib/i18n/locale-contract'

export const metadata: Metadata = {
  title: 'Abluo',
  description: 'Content. Simplified.',
}

type Props = {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

/**
 * Root layout for every locale-prefixed route (tenant websites, admin, client
 * dashboard). It owns `<html>` so the document language is the URL locale —
 * the root layout above `[locale]` cannot see that param, which is why `lang`
 * was once hardcoded to "en" on every page. See RootDocument.
 */
export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params

  if (!routing.locales.includes(locale as SupportedLocale)) {
    notFound()
  }

  // ── The locale of a request is established HERE, and only here ────────────
  //
  // `src/proxy.ts` has 21 return paths. Three of them hand the request to
  // next-intl's middleware (`intlMiddleware`), which sets the request locale:
  // the platform routes — admin, the client dashboard, login. The other
  // eighteen are `NextResponse.rewrite()` / `.next()`, because the proxy owns
  // host-to-tenant and path-to-tenant routing itself. EVERY tenant website
  // request takes one of those, and next-intl never sees it.
  //
  // So on a customer's site `requestLocale` was undefined, `src/i18n/request.ts`
  // fell back to `routing.defaultLocale`, and the whole app believed the page
  // was English — whatever the URL said.
  //
  // What that cost, measured in a browser on 2026-10-16: next-intl's
  // `usePathname()` removes the locale prefix by comparing against
  // `useLocale()`. Believing it was on "en", it returned "/it" unchanged, and
  // the language switcher asked the router for "/it" in French — sending the
  // visitor to /fr/it, which does not exist. Reproduced on nologo.cloud,
  // tmz.it and studiomartegani.com, from every language except English, where
  // the wrong answer happened to match. Switching twice stacked a third
  // segment. 57 components import Link / useRouter / usePathname from
  // `@/i18n/navigation` and all of them prefix URLs from this same value; the
  // switcher was merely the one that produced a visible 404.
  //
  // This layout is the single common ancestor of all six layouts under
  // `[locale]`, so establishing the locale here covers every route whichever
  // proxy branch ran, and leaves exactly one source of truth: the URL segment.
  setRequestLocale(locale)

  // Passed explicitly as well as via setRequestLocale: these two values are
  // what the BROWSER receives, and a provider holding the wrong locale is the
  // failure above. Explicit here keeps the client correct even if the
  // request-scope plumbing changes again.
  // Development and test only — see locale-contract.ts. If the plumbing above
  // ever stops working, this says so instead of quietly serving English.
  if (process.env.NODE_ENV !== 'production') {
    assertLocaleEstablished(locale, await getLocale())
  }

  const messages = await getMessages({ locale })

  return (
    <RootDocument lang={locale}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </RootDocument>
  )
}
