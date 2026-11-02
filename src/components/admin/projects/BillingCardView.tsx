'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { AddressAutocomplete } from '@/components/app/ui/AddressAutocomplete'
import { BillingStatusPill } from '@/components/app/ui/BillingStatusPill'
import { Button } from '@/components/app/ui/Button'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { CountryPicker } from '@/components/app/ui/CountryPicker'
import { countryName } from '@/components/app/ui/country-model'
import { DatePicker } from '@/components/app/ui/DatePicker'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import {
  acknowledgeBillingReviewAction,
  saveBillingProfileAction,
  saveBillingTermsAction,
  setBillingOverrideAction,
} from '@/lib/admin/billing/actions'
import { setCancelAtPeriodEndAction } from '@/lib/admin/billing/stripe-actions'
import {
  formatMoney,
  needsExtensionReason,
  overrideFieldErrors,
  overrideFormFrom,
  priceAppliesLater,
  profileFieldErrors,
  profileFieldsFor,
  profileFormFrom,
  removeOverrideInput,
  romeDate,
  romeEndDate,
  reviewFieldErrors,
  termsFieldErrors,
  termsFieldsFor,
  termsFormFrom,
  toOverrideInput,
  toProfileInput,
  toTermsInput,
  visibleActions,
  type FieldErrors,
  type OverrideForm,
  type ProfileForm,
  type TermsForm,
} from '@/lib/admin/billing/card'
import { parseEuroToCents } from '@/lib/admin/billing/model'
import type { BillingActionResult, ProjectBillingView } from '@/lib/admin/billing/types'
import type { BillingArrangement } from '@/lib/billing/lifecycle'
import { ACTIVATION_MAX_DAYS as ACTIVATION_DAYS } from '@/lib/billing/lifecycle'
import { formatDateTime } from '@/lib/i18n/date-locale'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

type Dialog = null | 'terms' | 'override' | 'removeOverride' | 'review' | 'profile' | 'cancelPeriod'

const icon = (d: ReactNode) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
)
const ARRANGEMENT_ICON: Record<BillingArrangement, ReactNode> = {
  stripe: icon(<path d="M3 6h18v12H3zM3 10h18M7 15h3" />),
  manual: icon(<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />),
  complimentary: icon(<path d="M4 9h16v4H4zM6 13v7h12v-7M12 9v11M12 9c-3 0-4-4-1.5-4.5S12 9 12 9zM12 9c3 0 4-4 1.5-4.5S12 9 12 9z" />),
}
const ARRANGEMENTS: BillingArrangement[] = ['stripe', 'manual', 'complimentary']

/**
 * Client part of the Billing card: the read view (status, terms, subscription
 * facts, the client's billing contact) and the dialogs that change them. Every
 * control is hidden unless the viewer holds billing.admin; the server actions
 * re-check. After a successful action: a toast and router.refresh().
 */
export function BillingCardView({ view }: { view: ProjectBillingView }) {
  const t = useTranslations('admin.billing')
  const locale = useLocale()
  const dateLocale = useDateLocale()
  const router = useRouter()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), [])

  const { agreement, subscription, profile, status } = view
  const can = visibleActions(view)
  const canCancelPeriod = view.canEdit && agreement?.arrangement === 'stripe' && subscription !== null

  const day = (ymd: string | null) => {
    const d = ymd ? new Date(`${ymd}T00:00:00Z`) : null
    return d && !Number.isNaN(d.getTime()) ? formatDateTime(dateLocale, d, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'
  }
  const stamp = (iso: string | null) => {
    const d = iso ? new Date(iso) : null
    return d && !Number.isNaN(d.getTime()) ? formatDateTime(dateLocale, d, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Rome' }) : '—'
  }
  const muted = (text: string) => <span className="block text-sm text-muted-foreground">{text}</span>

  function done(message: string) {
    setDialog(null)
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
    router.refresh()
  }
  const close = () => setDialog(null)

  const price = agreement
    ? agreement.arrangement === 'complimentary'
      ? t('price.none')
      : agreement.amountCents !== null && agreement.interval
        ? t(`price.${agreement.interval}`, { amount: formatMoney(agreement.amountCents, agreement.currency, dateLocale) })
        : '—'
    : null

  const lastChange = view.lastChange
    ? view.lastChange.actorEmail
      ? t('lastChangeBy', { actor: view.lastChange.actorEmail, date: stamp(view.lastChange.at) })
      : t('lastChangeOn', { date: stamp(view.lastChange.at) })
    : null

  return (
    <section id="billing" aria-labelledby="billing-heading" className="flex scroll-mt-6 flex-col gap-3">
      <div className="space-y-1">
        <SectionHeading id="billing-heading" title={t('heading')} />
        <p className="text-sm leading-5 text-muted-foreground">{t('body')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <BillingStatusPill status={status} billed={agreement !== null} testData={!view.livemode} />
      </div>

      {agreement === null ? (
        <EmptyState
          compact
          titleAs="p"
          title={t('notBilled.title')}
          body={t('notBilled.body')}
          action={
            can.setUp ? (
              <Button variant="primary" onClick={() => setDialog('terms')}>
                {t('actions.setUp')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Panel padding="none" className="px-4">
          <dl>
            <FactRow label={t('facts.arrangement')}>{t(`arrangement.${agreement.arrangement}.label`)}</FactRow>
            <FactRow label={t('facts.price')}>
              {price}
              {agreement.arrangement !== 'complimentary' && agreement.amountCents !== null ? muted(t('exclVat')) : null}
            </FactRow>
            {agreement.startsOn ? <FactRow label={t('facts.startsOn')}>{day(agreement.startsOn)}</FactRow> : null}
            {agreement.activationDueAt ? (
              <FactRow label={t('facts.activationDue')}>
                {day(romeDate(agreement.activationDueAt))}
                {agreement.activationExtensionReason ? muted(agreement.activationExtensionReason) : null}
              </FactRow>
            ) : null}
            {agreement.arrangement === 'manual' && agreement.manualPaidThrough ? (
              <FactRow label={t('facts.paidThrough')}>{day(agreement.manualPaidThrough)}</FactRow>
            ) : null}
            {subscription?.firstPaidAt ? <FactRow label={t('facts.firstPayment')}>{stamp(subscription.firstPaidAt)}</FactRow> : null}
            {subscription?.paymentFailedAt ? (
              <FactRow label={t('facts.paymentFailed')}>
                <span className="text-destructive">{stamp(subscription.paymentFailedAt)}</span>
              </FactRow>
            ) : null}
            {subscription?.currentPeriodEnd ? (
              <FactRow label={t(subscription.cancelAtPeriodEnd ? 'facts.endsOn' : 'facts.nextRenewal')}>{stamp(subscription.currentPeriodEnd)}</FactRow>
            ) : null}
            {agreement.override !== 'none' ? (
              <FactRow label={t('facts.override')}>
                {t(`override.state.${agreement.override}`)}
                {agreement.overrideUntil ? muted(t('override.until', { date: day(romeEndDate(agreement.overrideUntil)) })) : null}
                {agreement.overrideReason ? muted(agreement.overrideReason) : null}
              </FactRow>
            ) : null}
            {agreement.reviewAcknowledgedAt ? (
              <FactRow label={t('facts.reviewed')}>
                {stamp(agreement.reviewAcknowledgedAt)}
                {agreement.reviewNote ? muted(agreement.reviewNote) : null}
              </FactRow>
            ) : null}
            {lastChange ? <FactRow label={t('facts.lastChange')}>{lastChange}</FactRow> : null}
          </dl>
        </Panel>
      )}

      {agreement !== null && (can.editTerms || can.override || can.removeOverride || can.review || canCancelPeriod) ? (
        <div className="flex flex-wrap gap-2">
          {can.editTerms ? (
            <Button variant="secondary" onClick={() => setDialog('terms')}>
              {t('actions.editTerms')}
            </Button>
          ) : null}
          {can.override ? (
            <Button variant="secondary" onClick={() => setDialog('override')}>
              {t('actions.override')}
            </Button>
          ) : null}
          {can.removeOverride ? (
            <Button variant="secondary" onClick={() => setDialog('removeOverride')}>
              {t('actions.removeOverride')}
            </Button>
          ) : null}
          {canCancelPeriod ? (
            <Button variant="secondary" onClick={() => setDialog('cancelPeriod')}>
              {t(subscription?.cancelAtPeriodEnd ? 'actions.keepSubscription' : 'actions.cancelAtPeriodEnd')}
            </Button>
          ) : null}
          {can.review ? (
            <Button variant="primary" onClick={() => setDialog('review')}>
              {t('actions.review')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 space-y-1">
        <SectionHeading id="billing-contact-heading" title={t('contact.heading')} />
        <p className="text-sm leading-5 text-muted-foreground">
          {t('contact.shared')}
          {view.otherProjects.length ? ` ${t('contact.alsoUsedBy', { names: view.otherProjects.map((p) => p.name).join(', ') })}` : ''}
        </p>
      </div>
      {profile ? (
        <Panel padding="none" className="px-4">
          <dl>
            <FactRow label={t('contact.email')}>{profile.billingEmail ?? '—'}</FactRow>
            <FactRow label={t('contact.type')}>{profile.customerType ? t(`contact.types.${profile.customerType}`) : '—'}</FactRow>
            <FactRow label={t(profile.customerType === 'individual' ? 'contact.fullName' : 'contact.companyName')}>{profile.legalName ?? '—'}</FactRow>
            {profile.customerType === 'business' ? <FactRow label={t('contact.contactName')}>{profile.contactName ?? '—'}</FactRow> : null}
            <FactRow label={t('contact.country')}>{profile.country ? countryName(profile.country, locale) : '—'}</FactRow>
            {profile.customerType === 'business' ? (
              <FactRow label={t('contact.vat')}>
                {profile.vatId ? (
                  <>
                    <span className="font-mono text-sm">{profile.vatId}</span>
                    {muted(
                      profile.vatVerification === 'verified' && profile.vatVerifiedAt
                        ? t('contact.vatVerifiedOn', { date: stamp(profile.vatVerifiedAt) })
                        : t(`contact.vatStatus.${profile.vatVerification}`),
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">{t('contact.vatNone')}</span>
                )}
              </FactRow>
            ) : null}
            {profile.taxCode ? (
              <FactRow label={t('contact.taxCode')}>
                <span className="font-mono text-sm">{profile.taxCode}</span>
              </FactRow>
            ) : null}
          </dl>
        </Panel>
      ) : (
        <Notice tone="info">{t('contact.none')}</Notice>
      )}
      {can.editContact ? (
        <div>
          <Button variant="secondary" onClick={() => setDialog('profile')}>
            {t('actions.editContact')}
          </Button>
        </div>
      ) : null}

      {can.setUp || can.editTerms ? <TermsPanel key={`t-${agreement?.updatedAt ?? 'none'}`} open={dialog === 'terms'} view={view} onClose={close} onDone={() => done(t('toast.terms'))} /> : null}
      {can.override ? <OverrideDialog key={`o-${agreement?.updatedAt ?? 'none'}`} open={dialog === 'override'} view={view} onClose={close} onDone={() => done(t('toast.override'))} /> : null}
      {can.removeOverride ? <RemoveOverrideDialog open={dialog === 'removeOverride'} projectId={view.projectId} onClose={close} onDone={() => done(t('toast.overrideRemoved'))} /> : null}
      {can.review ? <ReviewDialog open={dialog === 'review'} projectId={view.projectId} onClose={close} onDone={() => done(t('toast.reviewed'))} /> : null}
      {canCancelPeriod && subscription ? (
        <CancelPeriodDialog
          open={dialog === 'cancelPeriod'}
          projectId={view.projectId}
          cancel={!subscription.cancelAtPeriodEnd}
          onClose={close}
          onDone={() => done(t(subscription.cancelAtPeriodEnd ? 'toast.subscriptionKept' : 'toast.cancelScheduled'))}
        />
      ) : null}
      {can.editContact ? <ProfilePanel key={`p-${JSON.stringify(profile)}`} open={dialog === 'profile'} view={view} onClose={close} onDone={() => done(t('toast.profile'))} /> : null}

      <Toast message={toast} />
    </section>
  )
}

type DialogProps = { open: boolean; onClose: () => void; onDone: () => void }

/** Shared submit state: busy flag, the server's field errors and a general error. */
function useSubmit(mapFields: (fields: string[] | undefined) => FieldErrors, onDone: () => void) {
  const t = useTranslations('admin.billing')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [general, setGeneral] = useState<string | null>(null)
  const reset = () => {
    setErrors({})
    setGeneral(null)
  }
  async function run(action: () => Promise<BillingActionResult>) {
    setBusy(true)
    reset()
    let r: BillingActionResult
    try {
      r = await action()
    } catch {
      r = { ok: false, error: 'failed' }
    }
    setBusy(false)
    if (r.ok) return onDone()
    const fieldErrors = mapFields(r.fields)
    setErrors(fieldErrors)
    // Field errors speak for themselves; otherwise say what kind of failure it was.
    setGeneral(Object.keys(fieldErrors).length && r.error === 'invalid' ? null : t(`errors.${r.error}`))
  }
  const err = (field: string) => (errors[field] ? t(`fieldErrors.${errors[field]}`) : undefined)
  return { busy, run, err, general, reset }
}

function TermsPanel({ open, view, onClose, onDone }: DialogProps & { view: ProjectBillingView }) {
  const t = useTranslations('admin.billing')
  const { agreement, subscription } = view
  const [form, setForm] = useState<TermsForm>(() => termsFormFrom(agreement))
  const s = useSubmit(termsFieldErrors, onDone)
  const today = romeDate(new Date().toISOString())
  const set = <K extends keyof TermsForm>(k: K, v: TermsForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    s.reset()
  }
  const shown = termsFieldsFor(form.arrangement)
  const reasonNeeded = shown.dueDate && form.activationDueOn !== '' && needsExtensionReason(form.activationDueOn, today)
  const later = priceAppliesLater(agreement, subscription, form, parseEuroToCents(form.amount))

  return (
    <SidePanel
      open={open}
      title={t(agreement ? 'terms.titleEdit' : 'terms.titleSetUp')}
      closeLabel={t('close')}
      onClose={() => {
        onClose()
        setForm(termsFormFrom(agreement))
        s.reset()
      }}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void s.run(() => saveBillingTermsAction(toTermsInput(view.projectId, form, today)))
        }}
      >
        <Field label={t('terms.arrangement')} error={s.err('arrangement')}>
          {() => (
            <ChoiceCardGrid kind="radio" label={t('terms.arrangement')}>
              {ARRANGEMENTS.map((a) => (
                <ChoiceCard
                  key={a}
                  icon={ARRANGEMENT_ICON[a]}
                  label={t(`arrangement.${a}.label`)}
                  description={t(`arrangement.${a}.hint`)}
                  selected={form.arrangement === a}
                  onSelect={() => set('arrangement', a)}
                />
              ))}
            </ChoiceCardGrid>
          )}
        </Field>

        {shown.price ? (
          <>
            <Field label={t('terms.amount')} hint={t('terms.amountHint')} error={s.err('amount')}>
              {(p) => (
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-[1.0625rem] text-muted-foreground">
                    €
                  </span>
                  <TextInput {...p} inputMode="decimal" autoComplete="off" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
                </div>
              )}
            </Field>
            <Field label={t('terms.interval')} error={s.err('interval')}>
              {() => (
                <SegmentedControl
                  label={t('terms.interval')}
                  value={form.interval}
                  onChange={(v) => set('interval', v)}
                  options={[
                    { value: 'month', label: t('terms.intervals.month') },
                    { value: 'year', label: t('terms.intervals.year') },
                  ]}
                />
              )}
            </Field>
            {later ? <Notice tone="info">{t('terms.priceLater')}</Notice> : null}
          </>
        ) : null}

        <Field label={t('terms.startsOn')} error={s.err('startsOn')}>
          {(p) => <DatePicker {...p} clearable value={form.startsOn} onChange={(v) => set('startsOn', v)} />}
        </Field>

        {shown.dueDate ? (
          <Field label={t('terms.activationDue')} hint={t('terms.activationDueHint')} error={s.err('activationDueOn')}>
            {(p) => <DatePicker {...p} clearable value={form.activationDueOn} onChange={(v) => set('activationDueOn', v)} />}
          </Field>
        ) : null}
        {reasonNeeded ? (
          <Field label={t('terms.reason')} hint={t('terms.reasonHint', { days: ACTIVATION_DAYS })} error={s.err('reason')}>
            {(p) => <TextArea {...p} rows={3} required value={form.reason} onChange={(e) => set('reason', e.target.value)} />}
          </Field>
        ) : null}

        {shown.paidThrough ? (
          <Field label={t('terms.paidThrough')} hint={t('terms.paidThroughHint')} error={s.err('paidThrough')}>
            {(p) => <DatePicker {...p} clearable value={form.paidThrough} onChange={(v) => set('paidThrough', v)} />}
          </Field>
        ) : null}

        {s.general ? <Notice tone="error">{s.general}</Notice> : null}
        <Button variant="primary" size="lg" fullWidth type="submit" disabled={s.busy}>
          {s.busy ? t('saving') : t('terms.save')}
        </Button>
      </form>
    </SidePanel>
  )
}

function OverrideDialog({ open, view, onClose, onDone }: DialogProps & { view: ProjectBillingView }) {
  const t = useTranslations('admin.billing')
  const [form, setForm] = useState<OverrideForm>(() => overrideFormFrom(view.agreement))
  const s = useSubmit(overrideFieldErrors, onDone)
  const set = <K extends keyof OverrideForm>(k: K, v: OverrideForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    s.reset()
  }
  return (
    <ConfirmDialog
      open={open}
      title={t('override.title')}
      body={t('override.body')}
      confirmLabel={t('override.confirm')}
      busy={s.busy}
      error={s.general}
      onConfirm={() => void s.run(() => setBillingOverrideAction(toOverrideInput(view.projectId, form)))}
      onCancel={() => {
        onClose()
        s.reset()
      }}
    >
      <div className="flex flex-col gap-4">
        <Field label={t('override.mode')} error={s.err('override')}>
          {() => (
            <SegmentedControl
              label={t('override.mode')}
              value={form.mode}
              onChange={(v) => set('mode', v)}
              options={[
                { value: 'allow', label: t('override.allow') },
                { value: 'restrict', label: t('override.restrict') },
              ]}
            />
          )}
        </Field>
        <Field label={t('override.untilLabel')} error={s.err('until')}>
          {(p) => <DatePicker {...p} clearable value={form.untilOn} onChange={(v) => set('untilOn', v)} />}
        </Field>
        <Field label={t('override.reason')} error={s.err('reason')}>
          {(p) => <TextArea {...p} rows={3} value={form.reason} onChange={(e) => set('reason', e.target.value)} />}
        </Field>
      </div>
    </ConfirmDialog>
  )
}

function RemoveOverrideDialog({ open, projectId, onClose, onDone }: DialogProps & { projectId: string }) {
  const t = useTranslations('admin.billing')
  const s = useSubmit(overrideFieldErrors, onDone)
  return (
    <ConfirmDialog
      open={open}
      title={t('override.removeTitle')}
      body={t('override.removeBody')}
      confirmLabel={t('override.removeConfirm')}
      busy={s.busy}
      error={s.general}
      onConfirm={() => void s.run(() => setBillingOverrideAction(removeOverrideInput(projectId)))}
      onCancel={() => {
        onClose()
        s.reset()
      }}
    />
  )
}

function CancelPeriodDialog({ open, projectId, cancel, onClose, onDone }: DialogProps & { projectId: string; cancel: boolean }) {
  const t = useTranslations('admin.billing')
  const s = useSubmit(reviewFieldErrors, onDone)
  const k = cancel ? 'cancelPeriod' : 'keepSubscription'
  return (
    <ConfirmDialog
      open={open}
      title={t(`${k}.title`)}
      body={t(`${k}.body`)}
      confirmLabel={t(`${k}.confirm`)}
      busy={s.busy}
      error={s.general}
      onConfirm={() => void s.run(() => setCancelAtPeriodEndAction({ projectId, cancel }))}
      onCancel={() => {
        onClose()
        s.reset()
      }}
    />
  )
}

function ReviewDialog({ open, projectId, onClose, onDone }: DialogProps & { projectId: string }) {
  const t = useTranslations('admin.billing')
  const [note, setNote] = useState('')
  const s = useSubmit(reviewFieldErrors, onDone)
  return (
    <ConfirmDialog
      open={open}
      title={t('review.title')}
      body={t('review.body')}
      confirmLabel={t('review.confirm')}
      busy={s.busy}
      error={s.err('state') ?? s.general}
      onConfirm={() => void s.run(() => acknowledgeBillingReviewAction({ projectId, note: note.trim() || null }))}
      onCancel={() => {
        onClose()
        s.reset()
      }}
    >
      <Field label={t('review.note')} error={s.err('note')}>{(p) => <TextArea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </ConfirmDialog>
  )
}

function ProfilePanel({ open, view, onClose, onDone }: DialogProps & { view: ProjectBillingView }) {
  const t = useTranslations('admin.billing')
  const [form, setForm] = useState<ProfileForm>(() => profileFormFrom(view.profile))
  const s = useSubmit(profileFieldErrors, onDone)
  const shown = profileFieldsFor(form.customerType, form.country)
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    s.reset()
  }
  type TextKey = Exclude<keyof ProfileForm, 'customerType' | 'country' | 'addressLine1'>
  const text = (k: TextKey, extra?: { type?: string; autoComplete?: string; maxLength?: number; label?: string; hint?: string }) => (
    <Field label={extra?.label ?? t(`profile.${k}`)} hint={extra?.hint} error={s.err(k)}>
      {(p) => <TextInput {...p} type={extra?.type} autoComplete={extra?.autoComplete} maxLength={extra?.maxLength} value={form[k]} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  )
  return (
    <SidePanel
      open={open}
      title={t('profile.title')}
      subtitle={t('contact.shared')}
      closeLabel={t('close')}
      onClose={() => {
        onClose()
        setForm(profileFormFrom(view.profile))
        s.reset()
      }}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void s.run(() => saveBillingProfileAction(toProfileInput(view.tenantId, form)))
        }}
      >
        <Field label={t('profile.customerType')} error={s.err('customerType')}>
          {() => (
            <SegmentedControl
              label={t('profile.customerType')}
              value={form.customerType}
              onChange={(v) => set('customerType', v)}
              options={[
                { value: 'business', label: t('contact.types.business') },
                { value: 'individual', label: t('contact.types.individual') },
              ]}
            />
          )}
        </Field>
        {text('legalName', { label: t(`profile.${shown.nameLabel}`), autoComplete: 'off', maxLength: 200 })}
        {shown.contactName ? text('contactName', { hint: t('profile.contactNameHint'), autoComplete: 'off', maxLength: 200 }) : null}
        {text('billingEmail', { type: 'email', autoComplete: 'off' })}
        <Field label={t('profile.addressLine1')} hint={t('profile.addressHint')} error={s.err('addressLine1')}>
          {(p) => (
            <AddressAutocomplete
              {...p}
              maxLength={200}
              value={form.addressLine1}
              onChange={(v) => set('addressLine1', v)}
              onSelect={(a) => {
                // A picked place replaces the whole address; the country only when the place names one.
                setForm((f) => ({
                  ...f,
                  addressLine1: a.addressLine1 ?? f.addressLine1,
                  postalCode: a.postalCode ?? '',
                  city: a.city ?? '',
                  region: a.region ?? '',
                  country: a.country ?? f.country,
                }))
                s.reset()
              }}
            />
          )}
        </Field>
        {text('addressLine2', { autoComplete: 'off' })}
        {text('postalCode', { autoComplete: 'off', maxLength: 20 })}
        {text('city', { autoComplete: 'off' })}
        {text('region', { autoComplete: 'off' })}
        <Field label={t('profile.country')} error={s.err('country')}>
          {(p) => <CountryPicker {...p} value={form.country} onChange={(code) => set('country', code)} clearable />}
        </Field>
        {shown.vatId ? text('vatId', { hint: t('profile.vatHint'), autoComplete: 'off' }) : null}
        {shown.taxCode ? text('taxCode', { hint: t('profile.taxCodeHint'), autoComplete: 'off', maxLength: 16 }) : null}
        {s.general ? <Notice tone="error">{s.general}</Notice> : null}
        <Button variant="primary" size="lg" fullWidth type="submit" disabled={s.busy}>
          {s.busy ? t('saving') : t('profile.save')}
        </Button>
      </form>
    </SidePanel>
  )
}
