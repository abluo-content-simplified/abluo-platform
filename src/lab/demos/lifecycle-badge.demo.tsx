'use client'

import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { DemoBlock, DemoStack } from '../demo-kit'

const STATUSES = ['draft', 'scheduled', 'published', 'unpublished', 'archived'] as const

export default function LifecycleBadgeDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Every status" note="status — draft, scheduled, published, unpublished, archived.">
        {STATUSES.map((s) => (
          <LifecycleBadge key={s} status={s} />
        ))}
      </DemoBlock>
      <DemoBlock title="Pending changes" note="changes — a draft sits next to the published version.">
        <LifecycleBadge status="published" changes />
      </DemoBlock>
      <DemoBlock title="Custom second pill" note="extra — replaces the pending-changes text, for example a date.">
        <LifecycleBadge status="scheduled" extra="Goes live 3 Nov, 09:00" />
      </DemoBlock>
      <DemoBlock title="One line" note="oneLine — never wraps; the second pill truncates in a narrow cell.">
        <div className="w-48 rounded-xl border border-border p-2">
          <LifecycleBadge status="scheduled" extra="Goes live on 3 November at 09:00" oneLine />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
