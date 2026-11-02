import type { PillTone } from '@/components/app/ui/list/cells'
import type { BillingStatusView } from '@/lib/admin/billing/types'

export type BillingPillModel = {
  /** Key under `app.billingStatus`. */
  key: 'notBilled' | 'paid' | 'complimentary' | 'notDue' | 'overrideAllowed' | 'overrideRestricted' | 'paymentDue' | 'paymentDueNoDays' | 'locked' | 'lockedNoDay' | 'needsReview' | 'checkData'
  tone: PillTone
  values?: { daysLeft?: number; day?: number }
}

/** The pure state → label key + tone mapping (the only place that decides what the pill says). */
/**
 * `billed` is kept for backwards compatibility and is deliberately ignored once a status is known:
 * a known reason (complimentary, override_restrict…) always wins over `billed === false`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function billingPillModel(status: BillingStatusView | null, _billed = true): BillingPillModel {
  if (!status) return { key: 'notBilled', tone: 'muted' }
  switch (status.state) {
    case 'reminder':
      return status.daysLeft == null
        ? { key: 'paymentDueNoDays', tone: 'highlight' }
        : { key: 'paymentDue', tone: 'highlight', values: { daysLeft: status.daysLeft } }
    case 'locked':
      if (status.reason === 'override_restrict') return { key: 'overrideRestricted', tone: 'highlight' }
      return status.day == null ? { key: 'lockedNoDay', tone: 'highlight' } : { key: 'locked', tone: 'highlight', values: { day: status.day } }
    case 'review':
      return { key: 'needsReview', tone: 'highlight' }
    case 'ok':
    default:
      switch (status.reason) {
        case 'paid':
          return { key: 'paid', tone: 'success' }
        case 'complimentary':
          return { key: 'complimentary', tone: 'success' }
        case 'override_allow':
          return { key: 'overrideAllowed', tone: 'outline' }
        case 'before_due':
          return { key: 'notDue', tone: 'muted' }
        case 'invalid_record':
          return { key: 'checkData', tone: 'highlight' }
        case 'not_billed':
          return { key: 'notBilled', tone: 'muted' }
        default:
          return { key: 'notDue', tone: 'muted' }
      }
  }
}

