'use client'

import { SettingsHeader } from '@/components/client/settings/SettingsTabs'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { buttonClass } from '@/components/app/ui/button-styles'
import { Toast } from '@/components/app/ui/Toast'
import { Pill } from '@/components/app/ui/list/cells'
import { BillingProfilePanel } from '@/components/billing/BillingProfilePanel'
import { useRouter } from '@/i18n/navigation'
import { BillingStatusPill } from '@/components/app/ui/BillingStatusPill'
import { FactRow } from '@/components/app/ui/FactRow'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { countryName } from '@/components/app/ui/country-model'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { billingActions, billingErrorKey, billingSentence } from '@/lib/billing/client-access'
import { openBillingPortalAction, saveOwnBillingProfileAction, startCheckoutAction } from '@/lib/billing/client-actions'
import type { ClientBillingSite, ClientBillingView } from '@/lib/billing/client-view'
import type { InvoiceSummary } from '@/lib/billing/stripe/service'

/**
 * Client dashboard — Billing (ADR-041 Phase 5). What this site costs and whether it is paid, the
 * client's billing details (the Owner edits them here, Tom 2026-11-02; invoice readers see them),
 * this site's invoices, the client's other sites, and — for the Owner only — "Pay Now" and the
 * Stripe portal for the payment method. The server actions re-check every permission; the buttons
 * only mirror what the person may do.
 */
export function BillingScreen({ projectSlug, view, checkout }: { projectSlug: string; view: ClientBillingView; checkout: 'success' | 'cancel' | null }) {
  const t = useTranslations('clientDashboard.billing')
  const locale = useLocale()
  const [pending, start] = useTransition()
  const [errorKey, setErrorKey] = useState<ReturnType<typeof billingErrorKey> | null>(null)
  const { current, access, profile } = view
  const actions = billingActions(current, access)
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), [])
  const saved = () => {
    setEditing(false)
    setErrorKey(null)
    setToast(t('details.saved'))
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
    router.refresh()
  }
  // Back from Stripe: once the payment is confirmed say so, not "being confirmed". The
  // ?checkout= marker is dropped from the address so a reload does not repeat the message.
  const confirmed = checkout === 'success' && current.status.reason === 'paid'
  useEffect(() => {
    if (!checkout) return
    const url = new URL(window.location.href)
    url.searchParams.delete('checkout')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }, [checkout])

  const go = (run: () => Promise<{ ok: true; url: string } | { ok: false; error: Parameters<typeof billingErrorKey>[0] }>) =>
    start(async () => {
      setErrorKey(null)
      try {
        const r = await run()
        if (r.ok) window.location.assign(r.url)
        else setErrorKey(billingErrorKey(r.error))
      } catch {
        setErrorKey('failed')
      }
    })

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeader ownTitle={t('title')} />

      {checkout === 'success' ? <Notice tone="info">{t(confirmed ? 'checkout.confirmed' : 'checkout.success')}</Notice> : null}
      {checkout === 'cancel' ? <Notice tone="neutral">{t('checkout.cancel')}</Notice> : null}
      {errorKey ? <Notice tone="error">{t(`errors.${errorKey}`)}</Notice> : null}

      <SiteSummary site={current} testData={!view.livemode}>
        {actions.pay || actions.portal ? (
          <div className="grid gap-2 sm:auto-cols-fr sm:grid-flow-col">
            {actions.pay ? (
              <Button variant="primary" fullWidth disabled={pending} onClick={() => go(() => startCheckoutAction({ projectSlug, locale }))}>
                {t('actions.payNow')}
              </Button>
            ) : null}
            {actions.portal ? (
              <Button variant="secondary" fullWidth disabled={pending} onClick={() => go(() => openBillingPortalAction({ projectSlug, locale }))}>
                {t('actions.portal')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {!access.canManage ? <p className="text-sm leading-5 text-muted-foreground">{t('ownerOnly')}</p> : null}
      </SiteSummary>

      <section aria-labelledby="billing-details" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading id="billing-details" title={t('details.heading')} />
          {access.canManage ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('details.edit')}
            </Button>
          ) : null}
        </div>
        <Panel>
          {profile ? (
            <dl>
              <FactRow label={t(profile.customerType === 'individual' ? 'details.fullName' : 'details.companyName')}>{profile.legalName || '—'}</FactRow>
              {profile.customerType === 'business' && profile.contactName ? <FactRow label={t('details.contactName')}>{profile.contactName}</FactRow> : null}
              <FactRow label={t('details.email')}>{profile.billingEmail || '—'}</FactRow>
              <FactRow label={t('details.country')}>{profile.country ? countryName(profile.country, locale) : '—'}</FactRow>
              {profile.customerType !== 'individual' ? (
                <FactRow label={t('details.vat')}>
                  {profile.vatId ? (
                    <>
                      {profile.vatId}
                      <span className="block text-sm text-muted-foreground">{t(`details.vatStatus.${profile.vatVerification}`)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </FactRow>
              ) : null}
              {profile.taxCode ? <FactRow label={t('details.taxCode')}>{profile.taxCode}</FactRow> : null}
            </dl>
          ) : (
            <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('details.none')}</p>
          )}
          {/* Invoice readers cannot edit: they ask. The Owner has Edit above. */}
          {!access.canManage ? (
            <p className="mt-3 text-sm leading-5 text-muted-foreground">
              {t('details.change')}{' '}
              <ButtonLink variant="link" href={`/${projectSlug}/support`}>
                {t('details.contact')}
              </ButtonLink>
            </p>
          ) : null}
        </Panel>
      </section>

      <Invoices invoices={view.invoices} />

      {view.others.length ? (
        <section aria-labelledby="billing-others" className="flex flex-col gap-3">
          <SectionHeading id="billing-others" title={t('others.heading')} />
          <ul className="flex flex-col gap-3">
            {view.others.map((site) => (
              <OtherSite key={site.projectId} site={site} testData={!view.livemode} />
            ))}
          </ul>
        </section>
      ) : null}

      {access.canManage ? (
        <BillingProfilePanel
          key={`p-${JSON.stringify(profile)}`}
          open={editing}
          profile={profile}
          title={t('details.editTitle')}
          audience="client"
          onClose={() => setEditing(false)}
          onSave={(fields) => saveOwnBillingProfileAction({ projectSlug, locale, profile: fields })}
          onDone={saved}
        />
      ) : null}
      <Toast message={toast} />
    </div>
  )
}

const INVOICE_TONE: Record<InvoiceSummary['status'], 'success' | 'highlight' | 'muted' | 'outline'> = {
  paid: 'success',
  open: 'highlight',
  void: 'muted',
  uncollectible: 'outline',
}

/** This site's invoices (from Stripe): date, number, amount, status, PDF. null = could not be read right now. */
function Invoices({ invoices }: { invoices: InvoiceSummary[] | null }) {
  const t = useTranslations('clientDashboard.billing.invoices')
  const format = useFormatter()
  return (
    <section id="invoices" aria-labelledby="billing-invoices" className="flex flex-col gap-3">
      <SectionHeading id="billing-invoices" title={t('heading')} />
      {invoices === null ? (
        <Notice tone="neutral">{t('unavailable')}</Notice>
      ) : invoices.length === 0 ? (
        <Panel>
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('empty')}</p>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {invoices.map((inv) => {
            const name = inv.number ?? t('noNumber')
            const amount = format.number(inv.amountCents / 100, { style: 'currency', currency: inv.currency.toUpperCase() })
            const date = format.dateTime(new Date(inv.date), { dateStyle: 'medium', timeZone: 'Europe/Rome' })
            const hosted = inv.hostedUrl
            return (
              <ListRow
                key={inv.id}
                onOpen={hosted ? () => window.open(hosted, '_blank', 'noopener,noreferrer') : undefined}
                label={hosted ? `${t('view')}: ${name}` : undefined}
                trailing={
                  inv.pdfUrl ? (
                    <a
                      href={inv.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('pdfLabel', { number: name })}
                      className={buttonClass({ variant: 'secondary' })}
                    >
                      {t('pdf')}
                    </a>
                  ) : undefined
                }
              >
                <span className="text-base leading-6 font-semibold">{date}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.9375rem] leading-6 tabular-nums">{amount}</span>
                  <Pill tone={INVOICE_TONE[inv.status]}>{t(`status.${inv.status}`)}</Pill>
                </span>
                <span className="text-sm leading-5 text-muted-foreground">{name}</span>
              </ListRow>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** "€ 240.00 per year, excl. VAT" — null when the site has no price (complimentary, not billed). */
function usePrice(site: ClientBillingSite): string | null {
  const t = useTranslations('clientDashboard.billing')
  const format = useFormatter()
  if (site.amountCents == null || !site.arrangement || site.arrangement === 'complimentary') return null
  const amount = format.number(site.amountCents / 100, { style: 'currency', currency: site.currency.toUpperCase() })
  const interval = site.interval ?? 'other'
  return site.intervalCount > 1 && site.interval
    ? t('priceEvery', { amount, interval, count: site.intervalCount })
    : t('price', { amount, interval })
}

function useSentence(site: ClientBillingSite): string {
  const t = useTranslations('clientDashboard.billing')
  const format = useFormatter()
  const s = billingSentence(site)
  const date = s.values?.date ? format.dateTime(new Date(s.values.date), { dateStyle: 'medium', timeZone: 'Europe/Rome' }) : undefined
  return t(`sentence.${s.key}`, { date: date ?? '', daysLeft: s.values?.daysLeft ?? 0 })
}

function SiteSummary({ site, testData, children }: { site: ClientBillingSite; testData: boolean; children?: React.ReactNode }) {
  const t = useTranslations('clientDashboard.billing')
  const format = useFormatter()
  const price = usePrice(site)
  const sentence = useSentence(site)
  const failed = site.paymentFailedAt && site.status.state !== 'ok' ? format.dateTime(new Date(site.paymentFailedAt), { dateStyle: 'medium', timeZone: 'Europe/Rome' }) : null
  return (
    <Panel as="section" aria-labelledby="billing-site" padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 id="billing-site" className="text-[1.0625rem] leading-6 font-semibold">
          {site.name}
        </h2>
        <BillingStatusPill status={site.status} billed={site.arrangement !== null} testData={testData} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base leading-6 font-semibold">{sentence}</p>
        {price ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{price}</p> : null}
        {failed ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('paymentFailed', { date: failed })}</p> : null}
      </div>
      {children}
    </Panel>
  )
}

function OtherSite({ site, testData }: { site: ClientBillingSite; testData: boolean }) {
  const sentence = useSentence(site)
  const price = usePrice(site)
  return (
    <ListRow href={`/${site.slug}/billing`}>
      <span className="text-base leading-6 font-semibold">{site.name}</span>
      <BillingStatusPill status={site.status} billed={site.arrangement !== null} testData={testData} />
      <span className="text-sm leading-5 text-muted-foreground">{price ? `${sentence} · ${price}` : sentence}</span>
    </ListRow>
  )
}
