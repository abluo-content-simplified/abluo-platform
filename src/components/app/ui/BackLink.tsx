import { Link } from '@/i18n/navigation'

/**
 * "‹ Events": the way back to the list above an editor or a "New …" page.
 * Sits above the PageHeader, top-left, 44px tall.
 *
 *   <BackLink href={`/${projectSlug}/agenda`} label={t('back')} />
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </Link>
  )
}
