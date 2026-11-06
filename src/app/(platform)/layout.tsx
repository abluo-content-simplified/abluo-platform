import type { Metadata } from 'next'
import '../globals.css'
import { RootDocument } from '@/components/RootDocument'
import { routing } from '@/i18n/routing'
import { clientIcons } from '@/lib/app-install'

export const metadata: Metadata = {
  title: 'Abluo',
  description: 'Content. Simplified.',
  // Sign-in, password reset and invite are client-facing: the light icon. Studio overrides with the dark one.
  icons: clientIcons,
}

/**
 * Root layout for the locale-less platform surfaces — login, password reset,
 * invite acceptance, Sanity Studio and the bare platform root.
 *
 * These URLs carry no locale segment, so the document language is the
 * platform's default locale. Every locale-prefixed route has its own root
 * layout at `src/app/[locale]/layout.tsx`, which sets `lang` from the URL.
 */
export default function PlatformRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RootDocument lang={routing.defaultLocale}>{children}</RootDocument>
}
