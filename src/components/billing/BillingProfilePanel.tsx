'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AddressAutocomplete } from '@/components/app/ui/AddressAutocomplete'
import { Button } from '@/components/app/ui/Button'
import { CountryPicker } from '@/components/app/ui/CountryPicker'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { TextInput } from '@/components/app/ui/TextInput'
import { profileFieldErrors, profileFieldsFor, profileFormFrom, toProfileFields, type FieldErrors, type ProfileForm } from '@/lib/admin/billing/card'
import type { BillingActionResult, BillingProfileView, SaveBillingProfileInput } from '@/lib/admin/billing/types'

/**
 * The client's billing details form in a SidePanel — ONE form for the admin
 * Billing card and the client's own Billing page (Tom, 2026-11-02). Fields
 * follow the customer type (business: company name, contact person, VAT
 * number; individual: full name, plus the codice fiscale in Italy), with the
 * shared CountryPicker and AddressAutocomplete. `onSave` gets the fields
 * (never a client id — each caller's server action decides that); the server
 * validates again. `audience` only changes the VAT hint.
 */
export function BillingProfilePanel({
  open,
  profile,
  title,
  subtitle,
  audience,
  onClose,
  onSave,
  onDone,
}: {
  open: boolean
  profile: BillingProfileView | null
  title: string
  subtitle?: string
  audience: 'admin' | 'client'
  onClose: () => void
  onSave: (fields: Omit<SaveBillingProfileInput, 'tenantId'>) => Promise<BillingActionResult>
  onDone: () => void
}) {
  const t = useTranslations('app.billingProfile')
  const [form, setForm] = useState<ProfileForm>(() => profileFormFrom(profile))
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [general, setGeneral] = useState<string | null>(null)
  const shown = profileFieldsFor(form.customerType, form.country)
  const reset = () => {
    setErrors({})
    setGeneral(null)
  }
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    reset()
  }
  const err = (field: string) => (errors[field] ? t(`fieldErrors.${errors[field]}`) : undefined)

  async function submit() {
    setBusy(true)
    reset()
    let r: BillingActionResult
    try {
      r = await onSave(toProfileFields(form))
    } catch {
      r = { ok: false, error: 'failed' }
    }
    setBusy(false)
    if (r.ok) return onDone()
    const fieldErrors = profileFieldErrors(r.fields)
    setErrors(fieldErrors)
    // Field errors speak for themselves; otherwise say what kind of failure it was.
    setGeneral(Object.keys(fieldErrors).length && r.error === 'invalid' ? null : t(`errors.${r.error}`))
  }

  type TextKey = Exclude<keyof ProfileForm, 'customerType' | 'country' | 'addressLine1'>
  const text = (k: TextKey, extra?: { type?: string; maxLength?: number; label?: string; hint?: string }) => (
    <Field label={extra?.label ?? t(k as 'billingEmail')} hint={extra?.hint} error={err(k)}>
      {(p) => <TextInput {...p} type={extra?.type} autoComplete="off" maxLength={extra?.maxLength} value={form[k]} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  )

  return (
    <SidePanel
      open={open}
      title={title}
      subtitle={subtitle}
      closeLabel={t('close')}
      onClose={() => {
        onClose()
        setForm(profileFormFrom(profile))
        reset()
      }}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={t('customerType')} error={err('customerType')}>
          {() => (
            <SegmentedControl
              label={t('customerType')}
              value={form.customerType}
              onChange={(v) => set('customerType', v)}
              options={[
                { value: 'business', label: t('types.business') },
                { value: 'individual', label: t('types.individual') },
              ]}
            />
          )}
        </Field>
        {text('legalName', { label: t(shown.nameLabel), maxLength: 200 })}
        {shown.contactName ? text('contactName', { hint: t('contactNameHint'), maxLength: 200 }) : null}
        {text('billingEmail', { type: 'email' })}
        <Field label={t('addressLine1')} hint={t('addressHint')} error={err('addressLine1')}>
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
                reset()
              }}
            />
          )}
        </Field>
        {text('addressLine2')}
        {text('postalCode', { maxLength: 20 })}
        {text('city')}
        {text('region')}
        <Field label={t('country')} error={err('country')}>
          {(p) => <CountryPicker {...p} value={form.country} onChange={(code) => set('country', code)} clearable />}
        </Field>
        {shown.vatId ? text('vatId', { hint: t(`vatHint.${audience}`) }) : null}
        {shown.taxCode ? text('taxCode', { hint: t('taxCodeHint'), maxLength: 16 }) : null}
        {general ? <Notice tone="error">{general}</Notice> : null}
        <Button variant="primary" size="lg" fullWidth type="submit" disabled={busy}>
          {busy ? t('saving') : t('save')}
        </Button>
      </form>
    </SidePanel>
  )
}
