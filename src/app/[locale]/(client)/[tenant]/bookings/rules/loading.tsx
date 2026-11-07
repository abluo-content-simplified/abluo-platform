import { PageShell } from '@/components/app/ui/PageShell'
import { Panel } from '@/components/app/ui/Panel'
import { Skeleton } from '@/components/app/ui/Skeleton'

/** Loading: the header and three skeleton sections. */
export default function BookingRulesLoading() {
  return (
    <PageShell>
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-9 w-48" />
        {[0, 1, 2].map((i) => (
          <Panel key={i} padding="md" className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </Panel>
        ))}
      </div>
    </PageShell>
  )
}
