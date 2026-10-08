import type { ReactNode } from 'react'

/**
 * The frame of every Abluo App page (client dashboard and admin): one width (6xl), left-aligned in
 * the content area, one vertical rhythm, and room at the bottom for the
 * floating selection bar / "+" on phones. Pages never choose their own width —
 * the guard test `pages-use-shell.test.ts` fails the build when a page
 * under `[tenant]/` or `(admin)/` does not render PageShell (listed exceptions aside).
 *
 *   <PageShell>
 *     <PageHeader title="Posts" actions={…} />
 *     <ListToolbar … />
 *     …
 *   </PageShell>
 */
export function PageShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`w-full max-w-6xl space-y-5 pb-28 md:pb-8 ${className}`}>{children}</div>
}
