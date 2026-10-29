import type { ReactNode } from 'react'

/**
 * The first row of every Abluo App page: the page title on the left, the
 * page's actions (ViewSwitch, primary button …) on the right — one row, top-aligned together; when the actions do not fit beside the title they wrap under it. The title is bigger from `md` up.
 *
 *   <PageHeader title="Posts" actions={<><ViewSwitch … /><NewPostLink … /></>} />
 */
export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3">
      <h1 className="min-w-[min(100%,12rem)] flex-1 text-xl leading-7 font-semibold tracking-tight md:text-[1.75rem] md:leading-9">{title}</h1>
      {actions ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
