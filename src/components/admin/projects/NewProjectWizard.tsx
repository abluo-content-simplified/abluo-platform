'use client'

import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { FactRow } from '@/components/app/ui/FactRow'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { FieldError } from '@/components/app/ui/FieldLabel'
import { ProgressBar } from '@/components/app/ui/ProgressBar'
import { OptionCards } from '@/components/app/ui/OptionCards'
import { Select } from '@/components/app/ui/Select'
import { TextInput } from '@/components/app/ui/TextInput'
import {
  FIELD_STEP,
  SLUG_MIN,
  WIZARD_STEPS,
  orderLocales,
  slugFromName,
  validateWizardInput,
  type WizardErrors,
  type WizardField,
  type WizardFieldError,
  type WizardInput,
  type ProvisioningRunView,
  type WizardStepId,
} from '@/lib/admin/provisioning/model'
import type { ClientOption, DesignSystemOption } from '@/lib/admin/provisioning/options'
import type { SupportedLocale } from '@/lib/i18n/locales'
import { checkWizardSlugsAction, startProvisioningAction, type WizardActionError } from '@/app/[locale]/(admin)/projects/new/actions'
import { ProvisioningRunPanel } from './ProvisioningRunPanel'

export type LocaleOption = { code: SupportedLocale; label: string }

type Draft = {
  clientMode: 'existing' | 'new' | null
  tenantId: string
  clientName: string
  clientSlug: string
  clientSlugEdited: boolean
  projectName: string
  projectSlug: string
  projectSlugEdited: boolean
  defaultLocale: SupportedLocale
  languages: SupportedLocale[]
  designSystemId: string
  ownerName: string
  ownerEmail: string
}

/** Fields each step validates before moving on. */
const STEP_FIELDS: Record<WizardStepId, WizardField[]> = {
  client: ['client', 'clientName', 'clientSlug'],
  project: ['projectName', 'projectSlug', 'defaultLocale', 'supportedLocales'],
  design: ['designSystem'],
  owner: ['ownerName', 'ownerEmail'],
  review: [],
}

function toInput(d: Draft): WizardInput {
  const owner = d.ownerName.trim() || d.ownerEmail.trim() ? { name: d.ownerName, email: d.ownerEmail } : null
  return {
    client: d.clientMode === 'new' ? { mode: 'new', name: d.clientName, slug: d.clientSlug } : { mode: 'existing', tenantId: d.tenantId },
    project: { name: d.projectName, slug: d.projectSlug, defaultLocale: d.defaultLocale, supportedLocales: d.languages },
    designSystemId: d.designSystemId,
    owner,
  }
}

/**
 * Admin "New client / New project" wizard (docs/engineering/new-project-wizard.md):
 * Client → Project → Design system → Owner → Review & create. Each step is
 * validated with the same pure function the server runs; the client and
 * project steps also ask the server whether the slugs are free (Supabase AND
 * Sanity). "Create" records a run and executes it; the result (or the step
 * that failed, with Retry) replaces the wizard.
 */
export function NewProjectWizard({
  clients,
  designSystems,
  locales,
  defaultLocale,
}: {
  clients: ClientOption[]
  designSystems: DesignSystemOption[]
  locales: LocaleOption[]
  defaultLocale: SupportedLocale
}) {
  const t = useTranslations('admin.newProject')
  const router = useRouter()
  const [step, setStep] = useState<WizardStepId>('client')
  const [draft, setDraft] = useState<Draft>({
    clientMode: clients.length ? null : 'new',
    tenantId: '',
    clientName: '',
    clientSlug: '',
    clientSlugEdited: false,
    projectName: '',
    projectSlug: '',
    projectSlugEdited: false,
    defaultLocale,
    languages: [defaultLocale],
    designSystemId: '',
    ownerName: '',
    ownerEmail: '',
  })
  const [errors, setErrors] = useState<WizardErrors>({})
  const [formError, setFormError] = useState<WizardActionError | null>(null)
  const [run, setRun] = useState<ProvisioningRunView | null>(null)
  const [pending, startTransition] = useTransition()

  const index = WIZARD_STEPS.indexOf(step)
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch }
      if ('clientName' in patch && !next.clientSlugEdited) next.clientSlug = slugFromName(next.clientName)
      if ('projectName' in patch && !next.projectSlugEdited) next.projectSlug = slugFromName(next.projectName)
      if ('defaultLocale' in patch) next.languages = orderLocales(next.defaultLocale, next.languages)
      return next
    })
    setErrors((e) => {
      const n = { ...e }
      for (const k of Object.keys(patch)) {
        const field = ({ tenantId: 'client', clientMode: 'client', clientName: 'clientName', clientSlug: 'clientSlug', projectName: 'projectName', projectSlug: 'projectSlug', defaultLocale: 'defaultLocale', languages: 'supportedLocales', designSystemId: 'designSystem', ownerName: 'ownerName', ownerEmail: 'ownerEmail' } as Record<string, WizardField>)[k]
        if (field) delete n[field]
        if (k === 'clientName') delete n.clientSlug
        if (k === 'projectName') delete n.projectSlug
      }
      return n
    })
    setFormError(null)
  }

  const errorText = (code: WizardFieldError | undefined) => (code ? t(`errors.${code}`, { min: SLUG_MIN }) : null)

  /** Pure validation errors of the fields on this step (the server repeats the same check). */
  const localErrors = (s: WizardStepId): WizardErrors => {
    const v = validateWizardInput(toInput(draft))
    const all: WizardErrors = v.ok ? {} : v.errors
    // A slug left empty because the name is empty reports on the name only.
    const out: WizardErrors = {}
    for (const f of STEP_FIELDS[s]) if (all[f]) out[f] = all[f]
    if (s === 'client' && draft.clientMode === null) out.client = 'required'
    return out
  }

  const go = (s: WizardStepId) => {
    setStep(s)
    setFormError(null)
    window.scrollTo?.({ top: 0 })
  }

  const next = () => {
    const local = localErrors(step)
    if (Object.keys(local).length) {
      setErrors((e) => ({ ...e, ...local }))
      return
    }
    const following = WIZARD_STEPS[index + 1]
    if (step === 'client' && draft.clientMode === 'new') {
      startTransition(async () => {
        const r = await checkWizardSlugsAction({ clientSlug: draft.clientSlug })
        if (!r.ok) return setFormError(r.error)
        if (Object.keys(r.errors).length) return setErrors((e) => ({ ...e, ...r.errors }))
        go(following)
      })
      return
    }
    if (step === 'project') {
      startTransition(async () => {
        const r = await checkWizardSlugsAction({
          projectSlug: draft.projectSlug,
          clientSlug: draft.clientMode === 'new' ? draft.clientSlug : null,
          tenantId: draft.clientMode === 'existing' ? draft.tenantId : null,
        })
        if (!r.ok) return setFormError(r.error)
        if (r.errors.projectSlug) return setErrors((e) => ({ ...e, projectSlug: r.errors.projectSlug }))
        go(following)
      })
      return
    }
    go(following)
  }

  const create = () => {
    startTransition(async () => {
      const r = await startProvisioningAction(toInput(draft))
      if (r.ok || r.run) {
        setRun(r.run ?? null)
        if (r.run) router.replace(`/projects/new?run=${r.run.id}`)
        if (!r.ok) setFormError(r.error)
        return
      }
      setFormError(r.error)
      if (r.fields && Object.keys(r.fields).length) {
        setErrors(r.fields)
        const first = WIZARD_STEPS.find((s) => (Object.keys(r.fields!) as WizardField[]).some((f) => FIELD_STEP[f] === s))
        if (first) setStep(first)
      }
    })
  }

  const selectedClient = clients.find((c) => c.id === draft.tenantId) ?? null
  const selectedDs = designSystems.find((d) => d.id === draft.designSystemId) ?? null
  const templates = useMemo(() => designSystems.filter((d) => d.role === 'template'), [designSystems])
  const others = useMemo(() => designSystems.filter((d) => d.role === 'active'), [designSystems])
  const localeLabel = (code: string) => locales.find((l) => l.code === code)?.label ?? code

  if (run) return <ProvisioningRunPanel run={run} />

  return (
    <div className="flex max-w-[672px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-sm leading-5 font-medium text-muted-foreground">
          {t('progress', { current: index + 1, total: WIZARD_STEPS.length })} · {t(`steps.${step}`)}
        </span>
        <ProgressBar value={(index + 1) / WIZARD_STEPS.length} label={t('progress', { current: index + 1, total: WIZARD_STEPS.length })} />
      </div>

      {step === 'client' ? (
        <section aria-labelledby="np-client" className="flex flex-col gap-5">
          <SectionHeading id="np-client" title={t('client.heading')} />
          {clients.length ? (
            <ChoiceCardGrid kind="radio" label={t('client.heading')} className="sm:grid-cols-2">
              <ChoiceCard icon={ICONS.building} label={t('client.existing')} selected={draft.clientMode === 'existing'} onSelect={() => set({ clientMode: 'existing' })} />
              <ChoiceCard icon={ICONS.plus} label={t('client.new')} selected={draft.clientMode === 'new'} onSelect={() => set({ clientMode: 'new' })} />
            </ChoiceCardGrid>
          ) : (
            <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('client.noClients')}</p>
          )}
          {errors.client && draft.clientMode === null ? <FieldError>{errorText(errors.client)}</FieldError> : null}

          {draft.clientMode === 'existing' ? (
            <Field className="min-w-0" label={t('client.pick')} error={errorText(errors.client)}>
              {(p) => (
                <Select {...p} value={draft.tenantId} onChange={(e) => set({ tenantId: e.target.value })}>
                  <option value="">{t('client.pickPlaceholder')}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.slug})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          {draft.clientMode === 'new' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field className="min-w-0" label={t('client.name')} error={errorText(errors.clientName)}>
                {(p) => (
                  <TextInput {...p} value={draft.clientName} placeholder={t('client.namePlaceholder')} onChange={(e) => set({ clientName: e.target.value })} autoComplete="off" />
                )}
              </Field>
              <Field className="min-w-0" label={t('client.slug')} hint={t('client.slugHelp')} error={errorText(errors.clientSlug)}>
                {(p) => (
                  <TextInput
                    {...p}
                    value={draft.clientSlug}
                    onChange={(e) => set({ clientSlug: e.target.value, clientSlugEdited: true })}
                    className="font-mono"
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 'project' ? (
        <section aria-labelledby="np-project" className="flex flex-col gap-5">
          <SectionHeading id="np-project" title={t('project.heading')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field className="min-w-0" label={t('project.name')} error={errorText(errors.projectName)}>
              {(p) => (
                <TextInput {...p} value={draft.projectName} placeholder={t('project.namePlaceholder')} onChange={(e) => set({ projectName: e.target.value })} autoComplete="off" />
              )}
            </Field>
            <Field className="min-w-0" label={t('project.slug')} hint={t('project.slugHelp', { slug: draft.projectSlug || '…' })} error={errorText(errors.projectSlug)}>
              {(p) => (
                <TextInput
                  {...p}
                  value={draft.projectSlug}
                  onChange={(e) => set({ projectSlug: e.target.value, projectSlugEdited: true })}
                  className="font-mono"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
          </div>
          <Field className="min-w-0" label={t('project.defaultLocale')} error={errorText(errors.defaultLocale)}>
            {(p) => (
              <Select {...p} value={draft.defaultLocale} onChange={(e) => set({ defaultLocale: e.target.value as SupportedLocale })} className="sm:max-w-xs">
                {locales.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm leading-5 font-semibold text-foreground">{t('project.languages')}</legend>
            <p className="text-sm leading-5 text-muted-foreground">{t('project.languagesHelp')}</p>
            <ul className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {locales.map((l) => {
                const isDefault = l.code === draft.defaultLocale
                const checked = isDefault || draft.languages.includes(l.code)
                return (
                  <li key={l.code} className="flex items-center gap-1">
                    <Checkbox
                      checked={checked}
                      disabled={isDefault}
                      aria-label={l.label}
                      onChange={(on) => set({ languages: orderLocales(draft.defaultLocale, on ? [...draft.languages, l.code] : draft.languages.filter((c) => c !== l.code)) })}
                    />
                    <span className="text-[0.9375rem] leading-6 text-foreground">
                      {l.label}
                      {isDefault ? <span className="text-muted-foreground"> · {t('project.defaultTag')}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ul>
            {errors.supportedLocales ? <FieldError>{errorText(errors.supportedLocales)}</FieldError> : null}
          </fieldset>
        </section>
      ) : null}

      {step === 'design' ? (
        <section aria-labelledby="np-design" className="flex flex-col gap-5">
          <div className="space-y-1">
            <SectionHeading id="np-design" title={t('design.heading')} />
            <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('design.help')}</p>
          </div>
          {designSystems.length === 0 ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('design.none')}</p> : null}
          {[
            { key: 'templates', items: templates },
            { key: 'projects', items: others },
          ].map((group) =>
            group.items.length ? (
              <div key={group.key} className="flex flex-col gap-2">
                <h3 className="text-sm leading-5 font-semibold text-foreground">{t(`design.${group.key}`)}</h3>
                <OptionCards
                  label={t(`design.${group.key}`)}
                  value={draft.designSystemId}
                  onChange={(id) => set({ designSystemId: id })}
                  options={group.items.map((d) => ({
                    value: d.id,
                    title: d.name,
                    body: (
                      <>
                        {d.role === 'template' ? t('design.templateNote') : t('design.copyNote', { project: d.projectSlug ?? '—' })}
                        {d.role === 'active' && d.parentName ? ` · ${t('design.inherits', { name: d.parentName })}` : ''}
                      </>
                    ),
                  }))}
                />
              </div>
            ) : null
          )}
          {errors.designSystem ? <FieldError>{errorText(errors.designSystem)}</FieldError> : null}
        </section>
      ) : null}

      {step === 'owner' ? (
        <section aria-labelledby="np-owner" className="flex flex-col gap-5">
          <div className="space-y-1">
            <SectionHeading id="np-owner" title={t('owner.heading')} />
            <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('owner.help')}</p>
            {draft.clientMode === 'existing' ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('owner.optional')}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field className="min-w-0" label={t('owner.name')} error={errorText(errors.ownerName)}>
              {(p) => <TextInput {...p} value={draft.ownerName} onChange={(e) => set({ ownerName: e.target.value })} autoComplete="off" />}
            </Field>
            <Field className="min-w-0" label={t('owner.email')} error={errorText(errors.ownerEmail)}>
              {(p) => (
                <TextInput {...p} type="email" inputMode="email" value={draft.ownerEmail} onChange={(e) => set({ ownerEmail: e.target.value })} autoCapitalize="none" autoComplete="off" spellCheck={false} />
              )}
            </Field>
          </div>
        </section>
      ) : null}

      {step === 'review' ? (
        <section aria-labelledby="np-review" className="flex flex-col gap-3">
          <SectionHeading id="np-review" title={t('review.heading')} />
          <dl className="rounded-xl border border-border bg-card px-4">
            <FactRow label={t('review.client')}>
              {draft.clientMode === 'new' ? t('review.newClient', { name: draft.clientName.trim(), slug: draft.clientSlug }) : selectedClient ? `${selectedClient.name} (${selectedClient.slug})` : '—'}
            </FactRow>
            <FactRow label={t('review.project')}>{draft.projectName.trim()}</FactRow>
            <FactRow label={t('review.slug')}>
              <span className="font-mono text-sm">{draft.projectSlug}</span>
            </FactRow>
            <FactRow label={t('review.languages')}>
              {orderLocales(draft.defaultLocale, draft.languages)
                .map((c, i) => (i === 0 ? `${localeLabel(c)} (${t('project.defaultTag')})` : localeLabel(c)))
                .join(', ')}
            </FactRow>
            <FactRow label={t('review.designSystem')}>
              {selectedDs ? (selectedDs.role === 'template' ? t('review.dsTemplate', { name: selectedDs.name }) : t('review.dsCopy', { name: selectedDs.name })) : '—'}
            </FactRow>
            <FactRow label={t('review.owner')}>{draft.ownerEmail.trim() ? `${draft.ownerName.trim()} · ${draft.ownerEmail.trim()}` : <span className="text-muted-foreground">{t('review.noOwner')}</span>}</FactRow>
            <FactRow label={t('review.status')}>{t('review.statusValue')}</FactRow>
            <FactRow label={t('review.start')}>{t('review.startValue')}</FactRow>
          </dl>
          <p className="text-sm leading-5 text-muted-foreground">{t('review.domainNote')}</p>
        </section>
      ) : null}

      {formError ? <FieldError>{t(`errors.${formError}`)}</FieldError> : null}

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        {index > 0 ? (
          <Button onClick={() => go(WIZARD_STEPS[index - 1])} disabled={pending}>
            {t('nav.back')}
          </Button>
        ) : (
          <span />
        )}
        {step === 'review' ? (
          <Button variant="primary" onClick={create} disabled={pending} aria-busy={pending || undefined}>
            {pending ? t('nav.creating') : t('nav.create')}
          </Button>
        ) : (
          <Button variant="primary" onClick={next} disabled={pending} aria-busy={pending || undefined}>
            {pending ? t('nav.checking') : t('nav.next')}
          </Button>
        )}
      </div>
    </div>
  )
}

const icon = (d: string) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const ICONS = {
  building: icon('M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4'),
  plus: icon('M12 5v14M5 12h14'),
}

