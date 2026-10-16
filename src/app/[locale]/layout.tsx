import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import '../globals.css'
import { routing } from '@/i18n/routing'
import type { SupportedLocale } from '@/lib/i18n/locales'
import { RootDocument } from '@/components/RootDocument'

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

  // The URL locale is the ONLY source of the request locale here.
  //
  // next-intl normally learns the locale from its own middleware. This app does
  // not run it — `src/proxy.ts` owns host and path routing — so without this
  // call `requestLocale` is undefined, `src/i18n/request.ts` falls back to
  // `routing.defaultLocale`, and EVERY page in every language resolved as "en".
  //
  // That was not a cosmetic bug. next-intl's `usePathname()` strips the locale
  // prefix by comparing against `useLocale()`; believing it was on "en", it
  // left "/it" in place, and the language switcher asked the router for "/it"
  // in French — producing /fr/it, a page that does not exist. Measured on
  // nologo.cloud, tmz.it and studiomartegani.com, from every language except
  // English, where the wrong guess happened to be right.
  setRequestLocale(locale)

  // `locale` passed explicitly to both, rather than relying on the call above:
  // these two are what the browser receives, and a provider holding the wrong
  // locale is the failure described above. Explicit here means the client is
  // correct even if the request-scope plumbing changes under us again.
  const messages = await getMessages({ locale })

  return (
    <RootDocument lang={locale}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </RootDocument>
  )
}
