'use client'

import { useState } from 'react'
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
import { Button, IconButton } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { FieldError, FieldLabel } from '@/components/app/ui/FieldLabel'
import { Select } from '@/components/app/ui/Select'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'

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
    <Field className="min-w-0" label={t(`form.${field}`)} error={errorText(errors[field])}>
      {(p) => (
        <Select {...p} value={draft[field]} onChange={(e) => set({ [field]: e.target.value } as Partial<BacklogInput>)}>
          {values.map((v) => (
            <option key={v} value={v}>
              {t(`${field}.${v}` as 'type.bug')}
            </option>
          ))}
        </Select>
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
      <Field className="min-w-0" label={t('form.title')} error={errorText(errors.title)}>
        {(p) => (
          <TextInput
            {...p}
            required
            maxLength={TITLE_MAX}
            value={draft.title}
            placeholder={t('form.titlePlaceholder')}
            onChange={(e) => set({ title: e.target.value })}
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
        <Field className="min-w-0" label={t('form.project')} error={errorText(errors.projectId)}>
          {(p) => (
            <Select {...p} value={draft.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })}>
              <option value="">{t('form.projectNone')}</option>
              {projects.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name} ({pr.slug})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field className="min-w-0" label={t('form.module')} hint={t('form.moduleHelp')} error={errorText(errors.moduleId)}>
          {(p) => (
            <TextInput
              {...p}
              value={draft.moduleId ?? ''}
              placeholder={t('form.modulePlaceholder')}
              onChange={(e) => set({ moduleId: e.target.value || null })}
              className="font-mono"
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
        </Field>
      </div>

      <Field className="min-w-0" label={t('form.body')} error={errorText(errors.body)}>
        {(p) => (
          <TextArea
            {...p}
            value={draft.body}
            placeholder={t('form.bodyPlaceholder')}
            onChange={(e) => set({ body: e.target.value })}
            rows={8}
            className="font-mono leading-6"
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <FieldLabel as="legend">{t('form.links')}</FieldLabel>
        <p className="text-sm leading-5 text-muted-foreground">{t('form.linksHelp')}</p>
        {draft.links.map((link, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="block sm:w-40 sm:shrink-0">
              <span className="sr-only">{t('form.linkLabel')}</span>
              <TextInput
                controlSize="md"
                flush
                value={link.label}
                placeholder={t('form.linkLabel')}
                onChange={(e) => set({ links: draft.links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)) })}
              />
            </label>
            <label className="block min-w-0 flex-1">
              <span className="sr-only">{t('form.linkUrl')}</span>
              <TextInput
                controlSize="md"
                flush
                type="url"
                inputMode="url"
                value={link.url}
                placeholder="https://"
                onChange={(e) => set({ links: draft.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)) })}
              />
            </label>
            <IconButton
              onClick={() => set({ links: draft.links.filter((_, j) => j !== i) })}
              aria-label={t('form.removeLink', { n: i + 1 })}
              className="self-end sm:self-auto"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </IconButton>
          </div>
        ))}
        {errors.links ? <FieldError>{errorText(errors.links)}</FieldError> : null}
        {draft.links.length < LINKS_MAX ? (
          <div>
            <Button onClick={() => set({ links: [...draft.links, { label: '', url: '' }] })}>{t('form.addLink')}</Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  )
}
