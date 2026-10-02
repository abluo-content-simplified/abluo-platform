import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { renderToStaticMarkup } from 'react-dom/server'

// next/font is a build-time loader; outside Next it has no runtime. Each loader
// only has to hand back a `variable` class name here.
vi.mock('next/font/google', () => {
  const font = () => ({ variable: 'font-var', className: 'font-class', style: {} })
  return { Geist_Mono: font, Barlow_Condensed: font, Poppins: font }
})
vi.mock('next-intl/server', () => ({ getMessages: async () => ({}) }))
vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
}))

import { RootDocument } from '@/components/RootDocument'
import LocaleLayout from '@/app/[locale]/layout'
import PlatformRootLayout from '@/app/(platform)/layout'

describe('<html lang> follows the URL locale', () => {
  it('RootDocument writes the lang it is given', () => {
    const html = renderToStaticMarkup(<RootDocument lang="it"><p>x</p></RootDocument>)
    expect(html).toMatch(/^<html lang="it"/)
  })

  it.each(['en', 'it', 'de'])('the [locale] root layout renders lang="%s"', async (locale) => {
    const el = await LocaleLayout({ children: <p>x</p>, params: Promise.resolve({ locale }) })
    expect(renderToStaticMarkup(el)).toContain(`<html lang="${locale}"`)
  })

  it('locale-less platform pages use the platform default locale', () => {
    const html = renderToStaticMarkup(<PlatformRootLayout><p>x</p></PlatformRootLayout>)
    expect(html).toContain('<html lang="en"')
  })

  it('there is no single top-level root layout that could hardcode the language again', () => {
    expect(existsSync(resolve(__dirname, '../../app/layout.tsx'))).toBe(false)
  })
})
