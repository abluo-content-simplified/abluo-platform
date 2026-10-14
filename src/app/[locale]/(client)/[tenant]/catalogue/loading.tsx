import { PageShell } from '@/components/app/ui/PageShell'

/** Spec §10.5 — loading: the header, the view tabs and three skeleton rows. */
export default function CatalogueLoading() {
  return (
    <PageShell>
      <div aria-busy="true" className="space-y-4">
        <div className="h-9 w-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-12 w-80 max-w-full animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3 rounded-xl border border-border p-3">
            <div className="size-[4.5rem] shrink-0 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  )
}
