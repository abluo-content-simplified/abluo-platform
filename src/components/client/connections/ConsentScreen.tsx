'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { buttonClass } from '@/components/app/ui/button-styles'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { Panel } from '@/components/app/ui/Panel'
import { RadioList } from '@/components/app/ui/RadioList'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { ConsentView } from '@/lib/connections/consent-view'
import type { SharedResources } from '@/lib/connections/types'
import { approveConnectAction, denyConnectAction } from '@/app/[locale]/(client)/connect/authorize/actions'

const KNOWN_ERRORS = ['forbidden', 'support_mode', 'project_not_found', 'sandbox_only', 'resources_invalid', 'nothing_selected'] as const

type Ready = Extract<ConsentView, { state: 'ready' }>

/** Field selection for one site: the existing connection's choice, else the defaults. */
function initialSelection(view: Ready, projectId: string | null): Record<string, string[]> {
  const shared: SharedResources | null = view.projects.find((p) => p.projectId === projectId)?.shared ?? null
  return Object.fromEntries(
    view.resources.map((r) => [
      r.name,
      shared?.[r.name] ? r.fields.filter((f) => shared[r.name].fields.includes(f.name)).map((f) => f.name) : r.fields.filter((f) => f.checked).map((f) => f.name),
    ]),
  )
}

/**
 * The consent screen (ADR-031 D2): which app, which website, what it may
 * read. Calm and explicit — personal data is never pre-ticked, nothing is
 * shared that is not listed, and the person can share less than asked.
 */
export function ConsentScreen({ view, params, title }: { view: ConsentView; params: Record<string, string | undefined>; title: string }) {
  const t = useTranslations('clientDashboard.connect')

  if (view.state === 'invalid' || view.state === 'redirect') {
    return <EmptyState title={t('invalidTitle')} body={t('invalidBody')} />
  }
  if (view.state === 'support_mode' || view.state === 'no_site') {
    return (
      <EmptyState
        title={t(view.state === 'support_mode' ? 'supportTitle' : 'noSiteTitle')}
        body={t(view.state === 'support_mode' ? 'supportBody' : 'noSiteBody', { app: view.appName })}
        action={
          <a href={view.cancelTo} className={buttonClass()}>
            {t('back', { app: view.appName })}
          </a>
        }
      />
    )
  }
  return <ReadyForm view={view} params={params} title={title} />
}

function ReadyForm({ view, params, title }: { view: Ready; params: Record<string, string | undefined>; title: string }) {
  const t = useTranslations('clientDashboard.connect')
  const [projectId, setProjectId] = useState<string | null>(view.preselectedProjectId)
  const [selection, setSelection] = useState<Record<string, string[]>>(() => initialSelection(view, view.preselectedProjectId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const app = view.appName
  const project = view.projects.find((p) => p.projectId === projectId) ?? null

  const pickProject = (id: string) => {
    setProjectId(id)
    setSelection(initialSelection(view, id))
    setError(null)
  }
  const toggle = (resource: string, field: string, on: boolean) =>
    setSelection((s) => ({ ...s, [resource]: on ? [...(s[resource] ?? []), field] : (s[resource] ?? []).filter((f) => f !== field) }))

  // A resource with nothing ticked is not shared at all.
  const chosen = Object.fromEntries(
    Object.entries(selection)
      .filter(([, fields]) => fields.length > 0)
      .map(([name, fields]) => [name, { fields }]),
  )

  async function go(action: () => Promise<{ ok: boolean; redirectTo?: string; error?: string }>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await action()
      if (r.redirectTo) {
        window.location.assign(r.redirectTo)
        return
      }
      setError(r.error && KNOWN_ERRORS.includes(r.error as never) ? r.error : 'failed')
    } catch {
      setError('failed')
    }
    setBusy(false)
  }

  const approve = () => {
    if (!projectId) return setError('project_not_found')
    if (Object.keys(chosen).length === 0) return setError('nothing_selected')
    void go(() => approveConnectAction({ params, projectId, resources: chosen }))
  }

  return (
    <Panel as="section" aria-labelledby="connect-heading" padding="none" className="space-y-6 p-5 md:p-7">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <h1 id="connect-heading" className="text-[1.375rem] leading-8 font-semibold text-foreground">
          {t('heading', { app })}
        </h1>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('intro', { app })}</p>
        {view.sandboxOnly ? <p className="rounded-xl bg-muted px-3 py-2 text-sm text-foreground">{t('sandboxNote')}</p> : null}
      </header>

      <RadioList
        legend={t('site')}
        name="project"
        value={projectId}
        onChange={pickProject}
        options={view.projects.map((p) => ({ value: p.projectId, label: p.name, description: p.existing ? t('alreadyConnected') : undefined }))}
      />

      <div className="space-y-4">
        <h2 className="text-[0.9375rem] font-semibold text-foreground">{t('shares', { app })}</h2>
        {view.resources.map((r) => (
          <fieldset key={r.name} className="space-y-1 rounded-xl border border-border px-4 py-3">
            <legend className="px-1 text-sm font-semibold text-foreground">{t(`resources.${r.name}`)}</legend>
            {r.fields.map((f) => {
              const label = t(`fields.${r.name}.${f.name}` as 'fields.event.name')
              const on = (selection[r.name] ?? []).includes(f.name)
              return (
                <label key={f.name} className="flex min-h-11 cursor-pointer items-center gap-3">
                  <Checkbox checked={on} onChange={(c) => toggle(r.name, f.name, c)} aria-label={label} />
                  <span className="text-[0.9375rem] text-foreground">
                    {label}
                    {f.personal ? <span className="ml-2 text-sm text-muted-foreground">· {t('personal')}</span> : null}
                  </span>
                </label>
              )
            })}
          </fieldset>
        ))}
        <p className="text-sm leading-6 text-muted-foreground">{t('alwaysIncluded')}</p>
      </div>

      <p className="text-sm leading-6 text-muted-foreground">{t('later', { app })}</p>

      {error ? (
        <p role="alert" className="rounded-xl border border-destructive px-3 py-2 text-sm text-destructive">
          {t(`errors.${error}` as 'errors.failed')}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button disabled={busy} onClick={() => void go(() => denyConnectAction({ params }))}>
          {t('cancel')}
        </Button>
        <Button variant="primary" disabled={busy || !project} onClick={approve}>
          {busy ? t('working') : project?.existing ? t('update') : t('allow')}
        </Button>
      </div>
    </Panel>
  )
}
