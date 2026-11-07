'use client'

import { useId, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { RadioList } from '@/components/app/ui/RadioList'
import { Select } from '@/components/app/ui/Select'
import { Switch } from '@/components/app/ui/Switch'
import { TextInput } from '@/components/app/ui/TextInput'
import { loadBookingRulesAction, saveBookingRulesAction, type BookingRulesFail } from '@/app/[locale]/(client)/[tenant]/bookings/rules/actions'
import type { RulesErrors, RulesField } from '@/lib/reservations/rules-form'
import { CANCEL_OUTCOMES, LIMITS as L, ORGANISER_OUTCOMES } from '@/lib/reservations/rules-form'
import type { RulesView } from '@/lib/reservations/server/settings-service'
import { LocalizedTextArea } from './LocalizedTextArea'
import { errorsOf, formFromValues, isUnchanged, valuesFromForm, type RulesForm } from './rules-state'

type Banner = { kind: 'saved'; previous: RulesForm } | { kind: 'undone' } | { kind: 'conflict' } | { kind: 'error'; error: BookingRulesFail['error'] }

/** A section: heading and one line of explanation on the left, an optional on/off switch at the right, the controls below. */
function Section({ title, intro, toggle, children }: { title: string; intro: string; toggle?: { checked: boolean; onChange: (on: boolean) => void; disabled: boolean }; children?: ReactNode }) {
  const id = useId()
  return (
    <Panel as="section" aria-labelledby={id} className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={id} className="text-[1.0625rem] font-semibold">
            {title}
          </h2>
          <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{intro}</p>
        </div>
        {toggle ? <Switch checked={toggle.checked} onChange={toggle.onChange} labelledBy={id} disabled={toggle.disabled} /> : null}
      </div>
      {children}
    </Panel>
  )
}

/** A block inside a section (no box of its own): h3, one line, optional switch, the controls. */
function Subsection({ title, intro, toggle, children }: { title: string; intro: string; toggle?: { checked: boolean; onChange: (on: boolean) => void; disabled: boolean }; children?: ReactNode }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id={id} className="text-[0.9375rem] font-semibold">
            {title}
          </h3>
          <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{intro}</p>
        </div>
        {toggle ? <Switch checked={toggle.checked} onChange={toggle.onChange} labelledBy={id} disabled={toggle.disabled} /> : null}
      </div>
      {children}
    </div>
  )
}

/**
 * Bookings → Booking rules (ADR-044 D7, D9, D13, D16.14/15): the site's default
 * rules for bookings — payments, cancellations, passes, the booking reference.
 * One page, one Save (top right). Sections whose capability Abluo has not
 * switched on do not exist for the tenant. Saving checks the version the page
 * loaded: if someone saved first, the page loads their version and asks again.
 * Courses and events can use "custom" rules later; these are the defaults.
 */
export function BookingRules({ projectSlug, initial }: { projectSlug: string; initial: RulesView | null }) {
  const t = useTranslations('clientDashboard.bookings.rules')
  const [view, setView] = useState<RulesView | null>(initial)
  const [form, setForm] = useState<RulesForm | null>(initial ? formFromValues(initial.values) : null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [serverErrors, setServerErrors] = useState<RulesErrors>({})
  const [shown, setShown] = useState(false)

  if (!view || !form) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('title')} />
        <EmptyState title={t('unavailableTitle')} body={t('unavailableBody')} />
      </div>
    )
  }

  const vis = view.visibility
  const editable = view.canManage
  const set = (patch: Partial<RulesForm>) => {
    setForm({ ...form, ...patch })
    setBanner(null)
    setServerErrors({})
  }
  const clientErrors = errorsOf(form, vis, view.languages)
  const errors: RulesErrors = { ...(shown ? clientErrors : {}), ...serverErrors }
  const invalid = Object.keys(clientErrors).length > 0
  const unchanged = isUnchanged(form, view.values, vis)

  const err = (field: RulesField): string | undefined => {
    const code = errors[field]
    if (!code) return undefined
    const range =
      field === 'holdDays' ? L.holdDays : field === 'cutoffHoursBeforeFirstSession' ? L.cutoffHours : field === 'selfCancel.deadlineHours' ? L.deadlineHours : field === 'signUpOpensDaysBefore' ? L.signUpOpensDays : L.answerChangeHours
    return t(`errors.${code}`, { min: range.min, max: range.max, chars: field === 'bankDetails' ? L.bankDetailsChars : L.paymentInstructionsChars })
  }

  function adopt(next: RulesView) {
    setView(next)
    setForm(formFromValues(next.values))
    setShown(false)
  }

  async function reloadAfter(fail: BookingRulesFail) {
    if (fail.error === 'conflict') {
      const r = await loadBookingRulesAction({ projectSlug })
      if (r.ok) adopt(r.view)
      setBanner({ kind: 'conflict' })
    } else if (fail.error === 'invalid') {
      setServerErrors(fail.errors ?? {})
      setShown(true)
      setBanner({ kind: 'error', error: 'invalid' })
    } else {
      setBanner({ kind: 'error', error: fail.error })
    }
  }

  async function save() {
    if (!view || !form) return
    if (invalid) {
      setShown(true)
      return
    }
    setBusy(true)
    const previous = formFromValues(view.values)
    const r = await saveBookingRulesAction({ projectSlug, expectedVersion: view.version, values: valuesFromForm(form, vis) })
    setBusy(false)
    if (!r.ok) return void (await reloadAfter(r))
    adopt(r.view)
    setBanner({ kind: 'saved', previous })
  }

  async function undo(previous: RulesForm) {
    if (!view) return
    setBusy(true)
    const r = await saveBookingRulesAction({ projectSlug, expectedVersion: view.version, values: valuesFromForm(previous, vis) })
    setBusy(false)
    if (!r.ok) return void (await reloadAfter(r))
    adopt(r.view)
    setBanner({ kind: 'undone' })
  }

  const outcomeOptions = (kind: 'cancel' | 'organiser') =>
    (kind === 'cancel' ? CANCEL_OUTCOMES : ORGANISER_OUTCOMES).map((o) => (
      <option key={o} value={o}>
        {t(`outcomes.${kind}.${o}`)}
      </option>
    ))

  const saveHint = !editable ? null : busy ? null : invalid && shown ? t('saveBlockedInvalid') : unchanged ? t('saveNothingChanged') : null

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        actions={
          editable ? (
            <Button variant="primary" disabled={busy || unchanged} onClick={() => void save()}>
              {busy ? t('saving') : t('save')}
            </Button>
          ) : null
        }
      />
      <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
      {saveHint ? <p className="text-sm text-muted-foreground">{saveHint}</p> : null}

      {!editable ? <Notice tone="info">{t('readOnly')}</Notice> : null}
      {banner?.kind === 'saved' ? (
        <Notice tone="dashed" layout="row" action={<Button variant="quiet" disabled={busy} onClick={() => void undo(banner.previous)}>{t('undo')}</Button>}>
          {t('savedBody')}
        </Notice>
      ) : null}
      {banner?.kind === 'undone' ? <Notice tone="info">{t('undoneBody')}</Notice> : null}
      {banner?.kind === 'conflict' ? <Notice tone="error" title={t('conflictTitle')}>{t('conflictBody')}</Notice> : null}
      {banner?.kind === 'error' ? <Notice tone="error" title={t(`failed.${banner.error}.title`)}>{t(`failed.${banner.error}.body`)}</Notice> : null}

      {vis.payments ? (
        <Section title={t('payments.title')} intro={t('payments.intro')} toggle={{ checked: form.acceptBankTransfer, onChange: (on) => set({ acceptBankTransfer: on }), disabled: !editable || busy }}>
          {form.acceptBankTransfer ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t('payments.holdDays')} hint={t('payments.holdDaysHint')} hintBelow error={err('holdDays')}>
                  {(p) => <TextInput {...p} inputMode="numeric" value={form.holdDays} disabled={!editable} onChange={(e) => set({ holdDays: e.target.value })} />}
                </Field>
                <Field label={t('payments.cutoffHours')} hint={t('payments.cutoffHoursHint')} hintBelow error={err('cutoffHoursBeforeFirstSession')}>
                  {(p) => <TextInput {...p} inputMode="numeric" value={form.cutoffHours} disabled={!editable} onChange={(e) => set({ cutoffHours: e.target.value })} />}
                </Field>
              </div>
              <LocalizedTextArea
                label={t('payments.bankDetails')}
                hint={t('payments.bankDetailsHint')}
                values={form.bankDetails}
                onChange={(next) => set({ bankDetails: next })}
                languages={view.languages}
                mainLocale={view.defaultLocale}
                maxLength={L.bankDetailsChars}
                rows={3}
                disabled={!editable}
                error={err('bankDetails')}
              />
              <LocalizedTextArea
                label={t('payments.instructions')}
                hint={t('payments.instructionsHint')}
                values={form.paymentInstructions}
                onChange={(next) => set({ paymentInstructions: next })}
                languages={view.languages}
                mainLocale={view.defaultLocale}
                maxLength={L.paymentInstructionsChars}
                disabled={!editable}
                error={err('paymentInstructions')}
              />
            </>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('cancellations.title')} intro={t('cancellations.intro')}>
        <div className="space-y-6">
          <Subsection
            title={t('cancellations.selfCancel.title')}
            intro={t('cancellations.selfCancel.intro')}
            toggle={{ checked: form.selfCancelEnabled, onChange: (on) => set({ selfCancelEnabled: on }), disabled: !editable || busy }}
          >
            {form.selfCancelEnabled ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t('cancellations.selfCancel.deadline')} hint={t('cancellations.selfCancel.deadlineHint')} hintBelow error={err('selfCancel.deadlineHours')}>
                  {(p) => <TextInput {...p} inputMode="numeric" value={form.selfCancelDeadline} disabled={!editable} onChange={(e) => set({ selfCancelDeadline: e.target.value })} />}
                </Field>
                <Field label={t('cancellations.outcome')} hint={t('cancellations.outcomeHint')} hintBelow>
                  {(p) => (
                    <Select {...p} value={form.selfCancelOutcome} disabled={!editable} onChange={(e) => set({ selfCancelOutcome: e.target.value as RulesForm['selfCancelOutcome'] })}>
                      {outcomeOptions('cancel')}
                    </Select>
                  )}
                </Field>
              </div>
            ) : null}
          </Subsection>

          {vis.absenceNotice ? (
            <Subsection
              title={t('cancellations.absence.title')}
              intro={t('cancellations.absence.intro')}
              toggle={{ checked: form.absenceEnabled, onChange: (on) => set({ absenceEnabled: on }), disabled: !editable || busy }}
            >
              {form.absenceEnabled ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <CheckboxCard
                    label={t('cancellations.absence.releasePlace')}
                    description={t('cancellations.absence.releasePlaceHint')}
                    checked={form.absenceReleasePlace}
                    disabled={!editable}
                    onChange={(on) => set({ absenceReleasePlace: on })}
                  />
                  <Field label={t('cancellations.outcome')} hint={t('cancellations.outcomeHint')} hintBelow>
                    {(p) => (
                      <Select {...p} value={form.absenceOutcome} disabled={!editable} onChange={(e) => set({ absenceOutcome: e.target.value as RulesForm['absenceOutcome'] })}>
                        {outcomeOptions('cancel')}
                      </Select>
                    )}
                  </Field>
                </div>
              ) : null}
            </Subsection>
          ) : null}

          <Subsection title={t('cancellations.organiser.title')} intro={t('cancellations.organiser.intro')}>
            <Field label={t('cancellations.organiser.outcome')} hint={t('cancellations.organiser.outcomeHint')} hintBelow>
              {(p) => (
                <Select {...p} value={form.organiserOutcome} disabled={!editable} onChange={(e) => set({ organiserOutcome: e.target.value as RulesForm['organiserOutcome'] })}>
                  {outcomeOptions('organiser')}
                </Select>
              )}
            </Field>
          </Subsection>
        </div>
      </Section>

      {vis.passes ? (
        <Section title={t('passes.title')} intro={t('passes.intro')}>
          <RadioList
            legend={t('passes.signUp')}
            name="pass-sign-up"
            value={form.passSignUp}
            onChange={(v) => set({ passSignUp: v })}
            options={[
              { value: 'off', label: t('passes.off'), description: t('passes.offHint'), disabled: !editable },
              { value: 'opt_in', label: t('passes.optIn'), description: t('passes.optInHint'), disabled: !editable },
            ]}
          />
          {form.passSignUp === 'opt_in' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t('passes.opens')} hint={t('passes.opensHint')} hintBelow error={err('signUpOpensDaysBefore')}>
                {(p) => <TextInput {...p} inputMode="numeric" value={form.signUpOpens} disabled={!editable} onChange={(e) => set({ signUpOpens: e.target.value })} />}
              </Field>
              <Field label={t('passes.changeUntil')} hint={t('passes.changeUntilHint')} hintBelow error={err('answerChangeUntilHoursBefore')}>
                {(p) => <TextInput {...p} inputMode="numeric" value={form.answerChangeHours} disabled={!editable} onChange={(e) => set({ answerChangeHours: e.target.value })} />}
              </Field>
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('reference.title')} intro={t('reference.intro')}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('reference.prefix')} hint={t('reference.prefixHint', { example: `${form.referencePrefix.trim().toUpperCase() || 'CYCE'}-7K2MQ` })} hintBelow error={err('referencePrefix')}>
            {(p) => (
              <TextInput
                {...p}
                value={form.referencePrefix}
                maxLength={L.referencePrefixMax}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                disabled={!editable}
                onChange={(e) => set({ referencePrefix: e.target.value.toUpperCase() })}
              />
            )}
          </Field>
        </div>
      </Section>
    </div>
  )
}
