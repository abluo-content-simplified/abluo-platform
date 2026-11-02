'use client'

import { BillingStatusPill } from '@/components/app/ui/BillingStatusPill'
import type { BillingStatusView } from '@/lib/admin/billing/types'
import { DemoBlock, DemoStack } from '../demo-kit'

const s = (p: Partial<BillingStatusView>): BillingStatusView => ({ state: 'ok', reason: 'paid', clockStartedAt: null, day: null, daysLeft: null, ...p })

export default function BillingStatusPillDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Paid and fine" note="Static sample data; nothing is read from billing.">
        <BillingStatusPill status={s({ reason: 'paid' })} />
        <BillingStatusPill status={s({ reason: 'complimentary' })} />
        <BillingStatusPill status={s({ reason: 'before_due' })} />
        <BillingStatusPill status={s({ reason: 'override_allow' })} />
      </DemoBlock>
      <DemoBlock title="Reminder and locked">
        <BillingStatusPill status={s({ state: 'reminder', reason: 'awaiting_first_payment', day: 3, daysLeft: 12 })} />
        <BillingStatusPill status={s({ state: 'reminder', reason: 'payment_failed', day: 13, daysLeft: 1 })} />
        <BillingStatusPill status={s({ state: 'locked', reason: 'payment_failed', day: 20 })} />
        <BillingStatusPill status={s({ state: 'locked', reason: 'override_restrict' })} />
        <BillingStatusPill status={s({ state: 'review', reason: 'payment_failed', day: 30 })} />
      </DemoBlock>
      <DemoBlock title="Other">
        <BillingStatusPill status={null} />
        <BillingStatusPill status={s({ reason: 'not_billed' })} />
        <BillingStatusPill status={s({ reason: 'invalid_record' })} />
        <BillingStatusPill status={s({ reason: 'paid' })} testData />
      </DemoBlock>
    </DemoStack>
  )
}
