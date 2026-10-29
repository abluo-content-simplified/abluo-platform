import type { ReactNode } from 'react'

/**
 * Wraps a page's "create" button in its header ("New post", "Add item" …).
 * The one place that decides where create buttons show: on phones (below `md`)
 * the raised "+" in the bottom tab bar is the only way to add something, so
 * the header button is hidden there; on iPad and computers it is the page's
 * single create button.
 *
 *   <PageHeader title="Posts" actions={<CreateAction><NewPostLink … /></CreateAction>} />
 *
 * Only for content types the tab bar's "What would you like to create?" panel
 * offers; a create button that panel does not offer must stay visible.
 */
export function CreateAction({ children }: { children: ReactNode }) {
  return <span className="hidden md:inline-flex">{children}</span>
}
