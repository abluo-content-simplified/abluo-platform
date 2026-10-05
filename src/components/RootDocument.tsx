import { Geist_Mono, Barlow_Condensed, Poppins } from 'next/font/google'
import { THEME_BOOT_SCRIPT } from '@/lib/design-system/theme-boot'

/**
 * RootDocument — the `<html>`/`<body>` shell shared by the app's root layouts.
 *
 * ── Why there are two root layouts ───────────────────────────────────────────
 * A root layout cannot see the `[locale]` param of the segment below it, so the
 * single `src/app/layout.tsx` used to hardcode `<html lang="en">` on every page,
 * including every Italian and German page of every tenant site — contradicting
 * the page's own hreflang and og:locale, and telling screen readers to read
 * Italian with English pronunciation.
 *
 * The idiomatic Next.js / next-intl answer is multiple root layouts:
 *   - `src/app/[locale]/layout.tsx` is the root for every locale-prefixed route
 *     (tenant websites, admin, client dashboard) and passes the URL locale here.
 *   - `src/app/(platform)/layout.tsx` is the root for the locale-less platform
 *     surfaces (login, password reset, invite, Studio, the bare platform root).
 *
 * Both render this component so fonts, the theme boot script and the body
 * classes stay defined in exactly one place.
 */

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const barlowCondensed = Barlow_Condensed({
  variable: '--font-barlow-condensed',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

// ─── FOUC prevention script ───────────────────────────────────────────────────
// Runs synchronously before first paint.
// Dark-first: `:root` = dark (no class). `html.light` = light override.
// Reads `abluo-theme` from localStorage; falls back to system preference.
// Draft previews may force the theme via `?theme=` — see theme-boot.ts.
const themeScript = THEME_BOOT_SCRIPT

export function RootDocument({ lang, children }: { lang: string; children: React.ReactNode }) {
  return (
    <html
      lang={lang}
      suppressHydrationWarning
      className={`${geistMono.variable} ${barlowCondensed.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Theme preference applied before paint to prevent flash */}
        {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  )
}
