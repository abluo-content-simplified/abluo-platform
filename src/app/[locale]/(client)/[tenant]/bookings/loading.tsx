import { PageShell } from '@/components/app/ui/PageShell'
import { Skeleton } from '@/components/app/ui/Skeleton'

/** Loading: the tab row, the header and a handful of skeleton rows. */
export default function BookingsLoading() {
  return (
    <PageShell>
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-11 w-64" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-11 w-full" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </PageShell>
  )
}
