import type { ReactNode } from 'react'

/**
 * The one content width of every Abluo App page (and of the notices above it).
 *
 * 6xl beside the expanded side nav. On computers (lg+), collapsing the client
 * dashboard's nav to its icon rail (`data-nav-d="rail"` on the SidebarStateProvider,
 * ADR-042) frees 16rem − 3.5rem = 12.5rem, and the frame grows by exactly that,
 * so wide list screens (tables) use the space instead of just shifting left.
 * Forms and editors keep their own reading width inside the frame (max-w-2xl);
 * phones and tablets are unchanged.
 */
export const PAGE_WIDTH = 'max-w-6xl lg:group-data-[nav-d=rail]/nav:max-w-[calc(72rem+12.5rem)]'

/**
 * The frame of every Abluo App page (client dashboard and admin): one width
 * (PAGE_WIDTH), left-aligned in the content area, one vertical rhythm, and
 * room at the bottom on computers (phones get theirs from the layout's main,
 * clearing the tab bar). Pages never choose their own width —
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
  return <div className={`w-full ${PAGE_WIDTH} space-y-5 md:pb-8 ${className}`}>{children}</div>
}
