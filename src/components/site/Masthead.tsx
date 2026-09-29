import Link from 'next/link'
import type { ResolvedNavLink } from '@/lib/sanity/types'

// ── Masthead header ───────────────────────────────────────────────────────────
//
// The alternative to the fixed top bar (siteConfig.headerAppearance.layout =
// 'masthead'): the logo is the page's title, drawn at the full width of the
// content column so it lines up with the sections below it, and it scrolls
// away with the page. Made for wordmark logos on portfolio-style sites
// (ameliez.com), where a 36px bar would shrink the name to a caption.
//
// No text of its own — the logo alt and the nav labels come from content.

interface MastheadProps {
  href: string
  logoSrc: string
  logoAlt: string
  navLinks?: ResolvedNavLink[]
}

export function Masthead({ href, logoSrc, logoAlt, navLinks = [] }: MastheadProps) {
  return (
    <header className="px-6 pt-6 md:px-10 md:pt-10 lg:px-16">
      <div className="mx-auto w-full" style={{ maxWidth: 'var(--layout-max-content-width, 1120px)' }}>
        <Link href={href} className="block">
          <img src={logoSrc} alt={logoAlt} className="block h-auto w-full" />
        </Link>
        {navLinks.length > 0 && (
          <nav className="mt-6">
            <ul className="flex list-none flex-wrap justify-center gap-x-8 gap-y-2">
              {navLinks.map((link, i) => (
                <li key={`${link.href}-${i}`}>
                  <Link
                    href={link.href}
                    target={link.external ? '_blank' : undefined}
                    rel={link.external ? 'noopener noreferrer' : undefined}
                    className="text-sm hover:opacity-70"
                    style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </header>
  )
}
