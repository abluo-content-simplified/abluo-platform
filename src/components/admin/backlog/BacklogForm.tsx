'use client'

import { useId, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import {
  BACKLOG_AREAS,
  BACKLOG_PRIORITIES,
  BACKLOG_STATUSES,
  BACKLOG_TYPES,
  LINKS_MAX,
  TITLE_MAX,
  validateBacklogInput,
  type BacklogField,
  type BacklogFieldError,
  type BacklogInput,
  type BacklogProjectOption,
} from '@/lib/admin/backlog-model'
import { CONTROL, SECONDARY_BUTTON } from './backlog-bits'

export type BacklogFieldErrors = Partial<Record<BacklogField, BacklogFieldError>>

/**
 * The create / edit form of a backlog item, shown inside the SidePanel. The
 * submit buttons live in the panel's action row (`form={id}`), so they stay
 * put while the form scrolls. Validated with the same pure function the server
 * uses; the server's own field errors are shown the same way.
 */
export function BacklogForm({
  id,
  initial,
  projects,
  serverErrors,
  onSubmit,
}: {
  id: string
  initial: BacklogInput
  projects: BacklogProjectOption[]
  serverErrors?: BacklogFieldErrors
  onSubmit: (input: BacklogInput) => void
}) {
  const t = useTranslations('admin.backlog')
  const [draft, setDraft] = useState<BacklogInput>(initial)
  const [localErrors, setLocalErrors] = useState<BacklogFieldErrors>({})
  const errors = { ...serverErrors, ...localErrors }
  const set = (patch: Partial<BacklogInput>) => {
    setDraft((d) => ({ ...d, ...patch }))
    // Editing a field clears its error.
    setLocalErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch)) delete next[k as BacklogField]
      return next
    })
  }

  const errorText = (code: BacklogFieldError | undefined) =>
    code ? t(`errors.${code === 'invalid' ? 'invalidValue' : code}` as 'errors.required') : null

  const submit = () => {
    const v = validateBacklogInput(draft)
    if (!v.ok) {
      setLocalErrors(v.errors)
      return
    }
    setLocalErrors({})
    onSubmit(v.value)
  }

  const select = <T extends string>(field: 'type' | 'area' | 'priority' | 'status', values: readonly T[]) => (
    <Field label={t(`form.${field}`)} error={errorText(errors[field])}>
      {(fid, describedBy) => (
        <select
          id={fid}
          aria-describedby={describedBy}
          value={draft[field]}
          onChange={(e) => set({ [field]: e.target.value } as Partial<BacklogInput>)}
          className={`${CONTROL} truncate`}
        >
          {values.map((v) => (
            <option key={v} value={v}>
              {t(`${field}.${v}` as 'type.bug')}
            </option>
          ))}
        </select>
      )}
    </Field>
  )

  return (
    <form
      id={id}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-5"
    >
      <Field label={t('form.title')} error={errorText(errors.title)}>
        {(fid, describedBy) => (
          <input
            id={fid}
            aria-describedby={describedBy}
            aria-invalid={errors.title ? true : undefined}
            required
            maxLength={TITLE_MAX}
            value={draft.title}
            placeholder={t('form.titlePlaceholder')}
            onChange={(e) => set({ title: e.target.value })}
            className={CONTROL}
            autoFocus
          />
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {select('type', BACKLOG_TYPES)}
        {select('priority', BACKLOG_PRIORITIES)}
        {select('area', BACKLOG_AREAS)}
        {select('status', BACKLOG_STATUSES)}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('form.project')} error={errorText(errors.projectId)}>
          {(fid, describedBy) => (
            <select
              id={fid}
              aria-describedby={describedBy}
              value={draft.projectId ?? ''}
              onChange={(e) => set({ projectId: e.target.value || null })}
              className={`${CONTROL} truncate`}
            >
              <option value="">{t('form.projectNone')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('form.module')} help={t('form.moduleHelp')} error={errorText(errors.moduleId)}>
          {(fid, describedBy) => (
            <input
              id={fid}
              aria-describedby={describedBy}
              aria-invalid={errors.moduleId ? true : undefined}
              value={draft.moduleId ?? ''}
              placeholder={t('form.modulePlaceholder')}
              onChange={(e) => set({ moduleId: e.target.value || null })}
              className={`${CONTROL} font-mono`}
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
        </Field>
      </div>

      <Field label={t('form.body')} error={errorText(errors.body)}>
        {(fid, describedBy) => (
          <textarea
            id={fid}
            aria-describedby={describedBy}
            value={draft.body}
            placeholder={t('form.bodyPlaceholder')}
            onChange={(e) => set({ body: e.target.value })}
            rows={8}
            className={`${CONTROL} h-auto min-h-40 py-2 font-mono text-sm leading-6`}
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm leading-5 font-semibold text-foreground">{t('form.links')}</legend>
        <p className="text-sm leading-5 text-muted-foreground">{t('form.linksHelp')}</p>
        {draft.links.map((link, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="block sm:w-40 sm:shrink-0">
              <span className="sr-only">{t('form.linkLabel')}</span>
              <input
                value={link.label}
                placeholder={t('form.linkLabel')}
                onChange={(e) => set({ links: draft.links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)) })}
                className={CONTROL}
              />
            </label>
            <label className="block min-w-0 flex-1">
              <span className="sr-only">{t('form.linkUrl')}</span>
              <input
                type="url"
                inputMode="url"
                value={link.url}
                placeholder="https://"
                onChange={(e) => set({ links: draft.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)) })}
                className={CONTROL}
              />
            </label>
            <button
              type="button"
              onClick={() => set({ links: draft.links.filter((_, j) => j !== i) })}
              aria-label={t('form.removeLink', { n: i + 1 })}
              className="grid size-11 shrink-0 place-items-center self-end rounded-full text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:self-auto"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
        {errors.links ? (
          <p role="alert" className="text-sm leading-5 text-destructive">
            {errorText(errors.links)}
          </p>
        ) : null}
        {draft.links.length < LINKS_MAX ? (
          <div>
            <button type="button" onClick={() => set({ links: [...draft.links, { label: '', url: '' }] })} className={SECONDARY_BUTTON}>
              {t('form.addLink')}
            </button>
          </div>
        ) : null}
      </fieldset>
    </form>
  )
}

function Field({
  label,
  help,
  error,
  children,
}: {
  label: string
  help?: string
  error?: string | null
  children: (id: string, describedBy: string | undefined) => ReactNode
}) {
  const id = useId()
  const helpId = help ? `${id}-help` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm leading-5 font-semibold text-foreground">
        {label}
      </label>
      {children(id, describedBy)}
      {help ? (
        <p id={helpId} className="text-sm leading-5 text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errId} role="alert" className="text-sm leading-5 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
