import type { ReactNode } from 'react'

/**
 * One label/value row of a facts list, with a hairline between rows. Render
 * inside a `<dl>`.
 *
 *   <dl><FactRow label="Email">a@b.it</FactRow>…</dl>
 *
 * Phones (below `md`): stacked — the muted label on its own line, the value
 * under it on the full width. iPad and desktop: two columns, a fixed-width
 * label column and the value beside it. Always left-aligned and top-aligned;
 * long emails and URLs wrap rather than overflow. Secondary info (a muted
 * second line) is composed by the caller inside the value.
 *
 * (People's detail sheet has a private copy named `Fact`; it can switch to this.)
 */
export function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2.5 text-[0.9375rem] last:border-b-0 md:min-h-10 md:flex-row md:items-start md:gap-4">
      <dt className="text-sm text-muted-foreground md:w-40 md:shrink-0 md:text-[0.9375rem]">{label}</dt>
      <dd className="min-w-0 text-left text-foreground [overflow-wrap:anywhere] md:flex-1">{children}</dd>
    </div>
  )
}
