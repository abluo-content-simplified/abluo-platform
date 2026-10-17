import type { ReactNode } from 'react'

/** One labelled example inside a Lab demo. Fixture copy is admin-only English. */
export function DemoBlock({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border pb-6 last:border-b-0 last:pb-0">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  )
}

export function DemoStack({ children }: { children: ReactNode }) {
  return <div className="space-y-6">{children}</div>
}
