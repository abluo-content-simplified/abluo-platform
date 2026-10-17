import { PageShell } from '@/components/app/ui/PageShell'
import { Skeleton } from '@/components/app/ui/Skeleton'

/** Spec §10.5 — loading: the header, the view tabs and three skeleton rows. */
export default function CatalogueLoading() {
  return (
    <PageShell>
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-12 w-80 max-w-full" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3 rounded-xl border border-border p-3">
            <Skeleton shape="block" className="size-[4.5rem] shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  )
}
