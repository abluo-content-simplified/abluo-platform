'use client'

import { useEffect, useId } from 'react'
import type { BillingPeriod } from '@/components/sections/pricing/BillingVariants'

/**
 * The monthly ⇄ yearly switch of the pricing sections.
 *
 * A radio group, so it works with no JavaScript at all: the visible price is
 * chosen by CSS (globals.css, "Billing switch") from whichever radio is
 * checked, for every pricing section on the page. JavaScript only adds:
 *   - several switches on one page stay in sync;
 *   - ?billing=yearly in the URL opens the yearly view (read here, on the
 *     client — the server never reads searchParams, so the page stays static);
 *   - choosing a period updates that parameter with replaceState.
 *
 * Labels come from the caller (pricing-messages.ts); nothing is typed here.
 */

const PARAM = 'billing'
const URL_VALUE: Record<BillingPeriod, string> = { month: 'monthly', year: 'yearly' }

function setAll(period: BillingPeriod) {
  document.querySelectorAll<HTMLInputElement>(`input[data-billing-switch][value="${period}"]`).forEach((el) => {
    el.checked = true
  })
}

export function BillingSwitch({
  legend,
  monthlyLabel,
  yearlyLabel,
  badge,
}: {
  legend: string
  monthlyLabel: string
  yearlyLabel: string
  badge: string | null
}) {
  const name = `billing-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get(PARAM)
      if (v === URL_VALUE.year) setAll('year')
    } catch {
      /* a malformed URL keeps the default */
    }
  }, [])

  function choose(period: BillingPeriod) {
    setAll(period)
    try {
      const url = new URL(window.location.href)
      if (period === 'year') url.searchParams.set(PARAM, URL_VALUE.year)
      else url.searchParams.delete(PARAM)
      window.history.replaceState(window.history.state, '', url)
    } catch {
      /* history unavailable — the switch still works */
    }
  }

  const option = (period: BillingPeriod, label: string, extra?: string | null) => (
    <label
      className="relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-5 py-2 text-[15px] font-medium transition-colors"
      style={{ fontFamily: 'var(--font-body)' }}
      data-billing-option={period}
    >
      <input
        type="radio"
        name={name}
        value={period}
        defaultChecked={period === 'month'}
        data-billing-switch=""
        className="sr-only"
        onChange={() => choose(period)}
      />
      <span>{label}</span>
      {extra && (
        <span className="text-xs font-semibold" style={{ color: 'var(--color-success, var(--color-primary))' }}>
          {extra}
        </span>
      )}
    </label>
  )

  return (
    <fieldset className="inline-flex" data-billing-switch-group="">
      <legend className="sr-only">{legend}</legend>
      <div
        className="inline-flex gap-1 rounded-full p-1"
        style={{ backgroundColor: 'var(--color-background-alt, var(--color-surface))', border: '1px solid var(--color-border)' }}
      >
        {option('month', monthlyLabel)}
        {option('year', yearlyLabel, badge)}
      </div>
    </fieldset>
  )
}
