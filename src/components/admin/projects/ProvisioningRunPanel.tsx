'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { CONTROL, PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/admin/backlog/backlog-bits'
import { nextStep, type ProvisionStepId, type ProvisioningRunView, type RunStatus } from '@/lib/admin/provisioning/model'
import { adminProjectHref } from '@/lib/admin/attention'
import { previewSiteUrl } from '@/lib/admin/projects-filter'
import { retryProvisioningAction, type WizardActionError } from '@/app/[locale]/(admin)/projects/new/actions'

/** Dictionary key per step id (next-intl keys cannot contain dots). */
const STEP_KEY: Record<ProvisionStepId, string> = {
  'supabase.tenant': 'supabaseTenant',
  'supabase.project': 'supabaseProject',
  'sanity.client': 'sanityClient',
  'sanity.designSystem': 'sanityDesignSystem',
  'sanity.project': 'sanityProject',
  'sanity.siteConfig': 'sanitySiteConfig',
  'sanity.homePage': 'sanityHomePage',
  'invite.owner': 'inviteOwner',
}

const RUN_TONE: Record<RunStatus, PillTone> = { pending: 'muted', running: 'highlight', failed: 'outline', completed: 'success' }

/** Typical Vercel records — Vercel shows the exact ones per domain (the copy says so). */
const DNS_RECORDS = [
  { type: 'A', name: '@', value: '76.76.21.21' },
  { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com' },
] as const

/**
 * One provisioning run: its steps (done / failed / waiting), the failure and
 * "Retry" (resumes at the step that failed), and — once complete — where the
 * project is and the steps that stay manual (route table, design, domain),
 * then "Connect Google" on the project page (never part of provisioning:
 * it needs the live domain, and a Google hiccup must not fail a run).
 */
export function ProvisioningRunPanel({ run: initial }: { run: ProvisioningRunView }) {
  const t = useTranslations('admin.newProject.run')
  const tn = useTranslations('admin.newProject')
  const [run, setRun] = useState(initial)
  const [error, setError] = useState<WizardActionError | null>(null)
  const [pending, startTransition] = useTransition()
  const [domain, setDomain] = useState('')

  const resumeAt = nextStep(run.plannedSteps, run.steps)
  const failedStep = run.status === 'failed' ? (run.plannedSteps.find((s) => run.steps[s]?.status === 'failed') ?? resumeAt) : null
  const canRetry = run.status === 'failed' || run.status === 'pending' || run.status === 'running'
  const invite = run.steps['invite.owner']?.result as { emailSent?: boolean } | undefined
  const shownDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || t('next.domain.placeholderDomain')

  const retry = () =>
    startTransition(async () => {
      setError(null)
      const r = await retryProvisioningAction(run.id)
      if (r.run) setRun(r.run)
      if (!r.ok) setError(r.error)
    })

  const stepState = (s: ProvisionStepId): 'done' | 'failed' | 'skipped' | 'waiting' => {
    const st = run.steps[s]?.status
    return st === 'done' || st === 'failed' || st === 'skipped' ? st : 'waiting'
  }

  return (
    <div className="flex max-w-[672px] flex-col gap-6">
      <div className="space-y-2">
        <h2 className="text-[1.0625rem] leading-6 font-semibold text-foreground">
          {run.status === 'completed' ? t('completedTitle', { name: run.projectName }) : t('heading', { name: run.projectName })}
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-5 text-muted-foreground">
          <Pill tone={RUN_TONE[run.status]}>{t(`status.${run.status}`)}</Pill>
          <span className="font-mono">{run.projectSlug}</span>
          <span>{t('clientLine', { name: run.tenantName })}</span>
        </div>
      </div>

      <ol aria-label={t('stepsLabel')} className="rounded-xl border border-border bg-card px-4">
        {run.plannedSteps.map((s) => {
          const state = stepState(s)
          const detail = run.steps[s]
          return (
            <li key={s} className="flex items-start justify-between gap-4 border-b border-border py-2.5 text-[0.9375rem] last:border-b-0">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-foreground">{t(`steps.${STEP_KEY[s]}`)}</span>
                {state === 'failed' && detail?.message ? <span className="font-mono text-xs leading-5 break-words text-destructive">{detail.message}</span> : null}
              </span>
              <span className="shrink-0">
                <Pill
                  tone={state === 'done' ? 'success' : state === 'failed' ? 'outline' : 'muted'}
                  icon={state === 'failed' ? <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" /> : undefined}
                >
                  {t(`stepStatus.${state}`)}
                </Pill>
              </span>
            </li>
          )
        })}
      </ol>

      {failedStep ? <p role="alert" className="text-sm leading-5 text-destructive">{t('failedAt', { step: t(`steps.${STEP_KEY[failedStep]}`) })}</p> : null}
      {error ? <p role="alert" className="text-sm leading-5 text-destructive">{tn(`errors.${error}`)}</p> : null}

      {canRetry ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={retry} disabled={pending} aria-busy={pending || undefined} className={PRIMARY_BUTTON}>
            {pending ? t('retrying') : run.status === 'failed' ? t('retry') : t('resume')}
          </button>
          <span className="text-sm leading-5 text-muted-foreground">{t('retryHelp')}</span>
        </div>
      ) : null}

      {run.status === 'completed' ? (
        <>
          {run.ownerEmail ? (
            <p className={`text-[0.9375rem] leading-6 ${invite?.emailSent === false ? 'text-destructive' : 'text-muted-foreground'}`}>
              {invite?.emailSent === false ? t('emailNotSent', { email: run.ownerEmail }) : t('invited', { email: run.ownerEmail })}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Link href={adminProjectHref(run.projectSlug)} className={PRIMARY_BUTTON}>
              {t('openProject')}
            </Link>
            <a href="/studio" target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
              {t('openStudio')}
            </a>
            <Link href="/projects/new" className={SECONDARY_BUTTON}>
              {t('another')}
            </Link>
          </div>

          <section aria-labelledby="np-next" className="flex flex-col gap-4">
            <SectionHeading id="np-next" title={t('next.heading')} />
            <NextStep n={1} title={t('next.routes.title')}>
              {t('next.routes.body', { url: previewSiteUrl(run.projectSlug).replace(/^https:\/\//, '') })}
              <Code>npm run routes:generate</Code>
            </NextStep>
            <NextStep n={2} title={t('next.studio.title')}>
              {t('next.studio.body', { name: run.projectName })}
            </NextStep>
            <NextStep n={3} title={t('next.domain.title')}>
              <span className="block">{t('next.domain.intro')}</span>
              <label className="mt-3 block max-w-xs">
                <span className="text-sm leading-5 font-semibold text-foreground">{t('next.domain.label')}</span>
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder={t('next.domain.placeholderDomain')}
                  className={`${CONTROL} mt-1.5 font-mono`}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
                <li>{t('next.domain.step1', { domain: shownDomain })}</li>
                <li>
                  {t('next.domain.step2')}
                  <table className="mt-2 w-full max-w-md text-left text-sm">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th scope="col" className="py-1 pr-3 font-medium">{t('next.domain.type')}</th>
                        <th scope="col" className="py-1 pr-3 font-medium">{t('next.domain.name')}</th>
                        <th scope="col" className="py-1 font-medium">{t('next.domain.value')}</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {DNS_RECORDS.map((r) => (
                        <tr key={r.type} className="border-t border-border">
                          <td className="py-1 pr-3">{r.type}</td>
                          <td className="py-1 pr-3">{r.name}</td>
                          <td className="py-1 break-all">{r.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <span className="mt-1 block text-sm leading-5 text-muted-foreground">{t('next.domain.recordsNote')}</span>
                </li>
                <li>{t('next.domain.step3', { domain: shownDomain, slug: run.projectSlug })}</li>
                <li>
                  {t('next.domain.step4')} <Code>npm run routes:generate</Code>
                </li>
                <li>{t('next.domain.step5')}</li>
              </ol>
            </NextStep>
            <NextStep n={4} title={t('next.google.title')}>
              <span className="block">{t('next.google.body')}</span>
              <Link href={`${adminProjectHref(run.projectSlug)}#google`} className={`${SECONDARY_BUTTON} mt-3`}>
                {t('next.google.open')}
              </Link>
            </NextStep>
          </section>
        </>
      ) : null}
    </div>
  )
}

function NextStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-[0.9375rem] leading-6 text-foreground">
        <h3 className="font-semibold">{title}</h3>
        <div className="mt-1 text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="mt-2 block w-fit rounded-md bg-muted px-2 py-1 font-mono text-sm text-foreground">{children}</code>
}
