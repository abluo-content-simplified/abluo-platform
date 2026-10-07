import type { ReactNode } from 'react'

/**
 * One label/value row of a facts list — label left, value right, top-aligned
 * content, a hairline between rows. Render inside a `<dl>`.
 *
 *   <dl><FactRow label="Email">a@b.it</FactRow>…</dl>
 *
 * (People's detail sheet has a private copy named `Fact`; it can switch to this.)
 */
export function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-start justify-between gap-4 border-b border-border py-2.5 text-[0.9375rem] last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-foreground">{children}</dd>
    </div>
  )
}
