import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
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

  const messages = await getMessages()

  return (
    <RootDocument lang={locale}>
      <NextIntlClientProvider messages={messages}>
        {children}
      </NextIntlClientProvider>
    </RootDocument>
  )
}
