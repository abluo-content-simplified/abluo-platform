'use client'

import { useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import { useDateLocale } from '@/lib/i18n/date-locale-context'
import type { BookingStatus, PaymentStatus } from '@/lib/reservations/types'

/** Booking status tones: the attention colour for what waits on the tenant, success when done, muted when closed. */
const STATUS_TONE: Record<BookingStatus, PillTone> = {
  pending: 'outline',
  held: 'highlight',
  awaiting_payment: 'highlight',
  confirmed: 'success',
  cancelled: 'muted',
  expired: 'muted',
}
const PAYMENT_TONE: Record<PaymentStatus, PillTone> = {
  unpaid: 'outline',
  partially_paid: 'highlight',
  paid: 'success',
  partially_refunded: 'outline',
  refunded: 'muted',
}

export function BookingStatusPill({ status }: { status: BookingStatus }) {
  const t = useTranslations('clientDashboard.bookings.status')
  return <Pill tone={STATUS_TONE[status]}>{t(status)}</Pill>
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  const t = useTranslations('clientDashboard.bookings.paymentStatus')
  return <Pill tone={PAYMENT_TONE[status]}>{t(status)}</Pill>
}

/** The "needs a look" flags, in the existing attention colour. */
export function ReviewFlags({ paymentReview, eligibilityReview }: { paymentReview: boolean; eligibilityReview: boolean }) {
  const t = useTranslations('clientDashboard.bookings.flag')
  return (
    <>
      {paymentReview ? <Pill tone="highlight">{t('paymentReview')}</Pill> : null}
      {eligibilityReview ? <Pill tone="highlight">{t('eligibilityReview')}</Pill> : null}
    </>
  )
}

/**
 * Money, dates and times of the Bookings screens: euro in the person's
 * number format, dates and 24-hour times in the SITE's time zone (the same
 * for every editor, and for the server render as for the browser).
 */
export function useBookingFormat(timeZone: string) {
  const dateLocale = useDateLocale()
  const formats = useMemo(() => {
    const zone = (() => {
      try {
        new Intl.DateTimeFormat('en', { timeZone })
        return timeZone
      } catch {
        return 'UTC'
      }
    })()
    return {
      money: new Intl.NumberFormat(dateLocale, { style: 'currency', currency: 'EUR' }),
      // A plain day ('2026-11-08', a payment date) has no time zone: format it as the day it is.
      day: new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
      date: new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone }),
      dateTime: new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }),
    }
  }, [dateLocale, timeZone])
  const money = useCallback((cents: number) => formats.money.format(cents / 100), [formats])
  const date = useCallback((iso: string | null | undefined) => {
    if (!iso) return ''
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
    return Number.isNaN(d.getTime()) ? '' : (iso.length === 10 ? formats.day : formats.date).format(d)
  }, [formats])
  const dateTime = useCallback((iso: string | null | undefined) => {
    if (!iso) return ''
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : formats.dateTime.format(d)
  }, [formats])
  return { money, date, dateTime }
}
