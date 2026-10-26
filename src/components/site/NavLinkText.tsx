import { Lock } from 'lucide-react'
import type { ResolvedNavLink } from '@/lib/sanity/types'

/**
 * A menu link's text — and, for a restricted page shown in the menu with a
 * lock (ADR-040), a small lock after it. The lock's accessible name is the
 * localized "Members only" carried on the resolved link (`lockedLabel`); no
 * text lives here. Server- and client-safe.
 */
export function NavLinkText({ link }: { link: Pick<ResolvedNavLink, 'label' | 'lockedLabel'> }) {
  if (!link.lockedLabel) return <>{link.label}</>
  return (
    <span className="inline-flex items-center gap-1.5" data-access="locked">
      {link.label}
      <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2} />
      <span className="sr-only">{` (${link.lockedLabel})`}</span>
    </span>
  )
}
