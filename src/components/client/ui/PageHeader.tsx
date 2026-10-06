import type { ReactNode } from 'react'

/**
 * The first row of every client list page: the page title on the left, the
 * page's actions (ViewSwitch, primary button …) on the right — one row, all
 * vertically centred together. The title is bigger from `md` up.
 *
 *   <PageHeader title="Posts" actions={<><ViewSwitch … /><NewPostLink … /></>} />
 */
export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="min-w-0 text-xl leading-7 font-semibold tracking-tight md:text-[1.75rem] md:leading-9">{title}</h1>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
