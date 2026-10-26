'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { RadioList } from '@/components/app/ui/RadioList'
import { TextInput } from '@/components/app/ui/TextInput'
import { LocalDate, Pill } from '@/components/app/ui/list/cells'
import {
  createAccessGroupAction,
  renameAccessGroupAction,
  setAccessGroupArchivedAction,
  setAccessGroupPasswordAction,
} from '@/app/[locale]/(client)/[tenant]/access/actions'
import type { AccessGroupView } from '@/lib/access/dashboard'
import { errorText, PasswordField } from './access-bits'
import type { AccessRunner } from './AccessScreen'

type Limits = { passwordMinLength: number; passwordMaxLength: number; nameMax: number }

/**
 * Groups (ADR-040 B2.5): who the members are, each with the password they
 * share. A group is created WITH its password, in one step; changing it later
 * signs out everyone who used the old one, and says so before and after.
 * Existing passwords are never shown — nobody knows them, not even Abluo.
 */
export function GroupsTab({
  projectSlug,
  groups,
  usage,
  canManage,
  limits,
  creating,
  onCreatingChange,
  runner,
}: {
  projectSlug: string
  groups: AccessGroupView[]
  /** How many pages / documents each group opens. */
  usage: Record<string, { pages: number; documents: number }>
  canManage: boolean
  limits: Limits
  creating: boolean
  onCreatingChange: (open: boolean) => void
  runner: AccessRunner
}) {
  const t = useTranslations('clientDashboard.access')
  const [passwordFor, setPasswordFor] = useState<AccessGroupView | null>(null)
  const [renaming, setRenaming] = useState<AccessGroupView | null>(null)
  const [archiving, setArchiving] = useState<AccessGroupView | null>(null)
  const [shared, setShared] = useState<{ group: string; password: string } | null>(null)

  const sorted = [...groups].sort((a, b) => Number(a.archived) - Number(b.archived))

  const menuFor = (g: AccessGroupView): CardMenuItem[] => {
    if (!canManage) return []
    if (g.archived) return [{ key: 'restore', label: t('groups.restore'), onSelect: () => void runner.run(() => setAccessGroupArchivedAction({ projectSlug, groupId: g.id, archived: false }), t('groups.restored', { name: g.name })) }]
    const inUse = g.passwords.some((p) => p.inUse)
    return [
      { key: 'password', label: inUse ? t('groups.changePassword') : t('groups.setPassword'), onSelect: () => setPasswordFor(g) },
      { key: 'rename', label: t('groups.rename'), onSelect: () => setRenaming(g) },
      { key: 'archive', label: t('groups.archive'), onSelect: () => setArchiving(g), destructive: true, separated: true },
    ]
  }

  return (
    <div className="flex flex-col gap-4">
      {sorted.length === 0 ? (
        <EmptyState
          title={t('groups.emptyTitle')}
          body={t('groups.emptyBody')}
          action={canManage ? <Button variant="primary" onClick={() => onCreatingChange(true)}>{t('groups.new')}</Button> : undefined}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {sorted.map((g) => {
            const items = menuFor(g)
            const inUse = g.passwords.filter((p) => p.inUse)
            const lastChange = inUse.map((p) => p.changedAt).sort().at(-1) ?? null
            const u = usage[g.id] ?? { pages: 0, documents: 0 }
            return (
              <Panel as="li" key={g.id} className="flex flex-col gap-3 md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <h3 className="truncate text-[1.0625rem] leading-6 font-semibold text-foreground">{g.name}</h3>
                    <span className="flex flex-wrap gap-1.5">
                      {g.archived ? <Pill tone="muted">{t('groups.archived')}</Pill> : inUse.length === 0 ? <Pill tone="highlight">{t('groups.noPassword')}</Pill> : null}
                    </span>
                  </div>
                  {items.length ? <CardMenu label={t('groups.actionsFor', { name: g.name })} items={items} /> : null}
                </div>
                <dl>
                  <FactRow label={t('groups.password')}>
                    {inUse.length === 0 ? (
                      <span className="text-muted-foreground">{t('groups.passwordNone')}</span>
                    ) : (
                      <>
                        {inUse.length > 1 ? `${t('groups.passwordCount', { count: inUse.length })} · ` : null}
                        {t('groups.passwordChanged')} <LocalDate iso={lastChange} />
                      </>
                    )}
                  </FactRow>
                  <FactRow label={t('groups.opens')}>{t('groups.opensCount', { pages: u.pages, documents: u.documents })}</FactRow>
                  {g.signedIn !== null && !g.archived ? <FactRow label={t('groups.signedIn')}>{t('visitors', { count: g.signedIn })}</FactRow> : null}
                </dl>
                {canManage && !g.archived && inUse.length === 0 ? (
                  <div>
                    <Button variant="secondary" onClick={() => setPasswordFor(g)}>{t('groups.setPassword')}</Button>
                  </div>
                ) : null}
              </Panel>
            )
          })}
        </ul>
      )}

      <NewGroupSheet
        open={creating}
        onClose={() => onCreatingChange(false)}
        projectSlug={projectSlug}
        limits={limits}
        onCreated={(name, password) => {
          onCreatingChange(false)
          setShared({ group: name, password })
          runner.done(t('groups.created', { name }))
        }}
      />
      <PasswordSheet
        group={passwordFor}
        onClose={() => setPasswordFor(null)}
        projectSlug={projectSlug}
        limits={limits}
        onChanged={(g, password, signedOut) => {
          setPasswordFor(null)
          setShared({ group: g.name, password })
          runner.done(signedOut > 0 ? t('groups.passwordChangedToast', { count: signedOut }) : t('groups.passwordSetToast'))
        }}
      />
      <RenameSheet
        title={t('groups.renameTitle')}
        label={t('groups.name')}
        initial={renaming?.name ?? null}
        maxLength={limits.nameMax}
        onClose={() => setRenaming(null)}
        onSave={async (name) => {
          const g = renaming!
          const ok = await runner.run(() => renameAccessGroupAction({ projectSlug, groupId: g.id, name }), t('groups.renamed'))
          if (ok === true) setRenaming(null)
          return ok === true
        }}
      />
      {canManage ? (
        <ConfirmDialog
          open={archiving !== null}
          title={t('groups.archiveConfirm.title', { name: archiving?.name ?? '' })}
          body={t('groups.archiveConfirm.body')}
          confirmLabel={t('groups.archive')}
          busy={runner.busy}
          onConfirm={() => {
            const g = archiving!
            setArchiving(null)
            void runner.run(() => setAccessGroupArchivedAction({ projectSlug, groupId: g.id, archived: true }), t('groups.archivedToast', { name: g.name }))
          }}
          onCancel={() => setArchiving(null)}
        />
      ) : null}
      <SharePasswordSheet shared={shared} onClose={() => setShared(null)} />
    </div>
  )
}

function NewGroupSheet({
  open,
  onClose,
  projectSlug,
  limits,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  projectSlug: string
  limits: Limits
  onCreated: (name: string, password: string) => void
}) {
  const t = useTranslations('clientDashboard.access')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ field: 'name' | 'password' | 'form'; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each opening starts empty
    setName('')
    setPassword('')
    setError(null)
  }, [open])

  async function create() {
    if (busy) return
    const n = name.trim()
    if (!n) return setError({ field: 'name', text: t('errors.name_needed') })
    if ([...password].length < limits.passwordMinLength) return setError({ field: 'password', text: errorText(t, 'password_too_short', limits) })
    setBusy(true)
    setError(null)
    try {
      const r = await createAccessGroupAction({ projectSlug, name: n, password })
      if (!r.ok) {
        const field = r.error.startsWith('password_') ? 'password' : r.error.startsWith('name_') ? 'name' : 'form'
        setError({ field, text: errorText(t, r.error, limits) })
        return
      }
      onCreated(n, password)
    } catch {
      setError({ field: 'form', text: t('errors.failed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} title={t('groups.newTitle')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('groups.newIntro')}</p>
        <Field label={t('groups.name')} hint={t('groups.nameHint')} error={error?.field === 'name' ? error.text : null}>
          {(p) => <TextInput {...p} autoFocus value={name} maxLength={limits.nameMax} placeholder={t('groups.namePlaceholder')} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <PasswordField
          label={t('groups.password')}
          value={password}
          onChange={(v) => {
            setPassword(v)
            if (error?.field === 'password') setError(null)
          }}
          error={error?.field === 'password' ? error.text : null}
          minLength={limits.passwordMinLength}
          maxLength={limits.passwordMaxLength}
        />
        {error?.field === 'form' ? <Notice tone="error">{error.text}</Notice> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? t('groups.creating') : t('groups.create')}</Button>
        </div>
      </form>
    </BottomSheet>
  )
}

function PasswordSheet({
  group,
  onClose,
  projectSlug,
  limits,
  onChanged,
}: {
  group: AccessGroupView | null
  onClose: () => void
  projectSlug: string
  limits: Limits
  onChanged: (g: AccessGroupView, password: string, signedOut: number) => void
}) {
  const t = useTranslations('clientDashboard.access')
  const inUse = group?.passwords.filter((p) => p.inUse) ?? []
  const [which, setWhich] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!group) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each opening starts empty
    setPassword('')
    setError(null)
    setWhich(group.passwords.find((p) => p.inUse)?.id ?? null)
  }, [group])

  async function save() {
    if (!group || busy) return
    if ([...password].length < limits.passwordMinLength) return setError(errorText(t, 'password_too_short', limits))
    setBusy(true)
    setError(null)
    try {
      const r = await setAccessGroupPasswordAction({ projectSlug, groupId: group.id, credentialId: which, password })
      if (!r.ok) return setError(errorText(t, r.error, limits))
      onChanged(group, password, r.signedOut)
    } catch {
      setError(t('errors.failed'))
    } finally {
      setBusy(false)
    }
  }

  const changing = inUse.length > 0
  return (
    <BottomSheet open={group !== null} title={changing ? t('groups.changePasswordTitle', { name: group?.name ?? '' }) : t('groups.setPasswordTitle', { name: group?.name ?? '' })} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {changing ? (
          <Notice tone="info">
            {group?.signedIn ? t('groups.changeWarningCount', { count: group.signedIn }) : t('groups.changeWarning')}
          </Notice>
        ) : (
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('groups.setPasswordIntro')}</p>
        )}
        {inUse.length > 1 ? (
          <RadioList
            legend={t('groups.whichPassword')}
            name="access-password"
            value={which}
            onChange={setWhich}
            options={inUse.map((p) => ({ value: p.id, label: p.label }))}
          />
        ) : null}
        <PasswordField
          label={t('groups.newPassword')}
          value={password}
          onChange={(v) => {
            setPassword(v)
            setError(null)
          }}
          error={error}
          minLength={limits.passwordMinLength}
          maxLength={limits.passwordMaxLength}
          autoFocus
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? t('saving') : changing ? t('groups.changePassword') : t('groups.setPassword')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  )
}

/** Right after a password is set: the one moment it is shown, to copy and share. Nothing stores it. */
function SharePasswordSheet({ shared, onClose }: { shared: { group: string; password: string } | null; onClose: () => void }) {
  const t = useTranslations('clientDashboard.access')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per password
    setCopied(false)
  }, [shared])
  return (
    <BottomSheet open={shared !== null} title={t('share.title')} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('share.body', { name: shared?.group ?? '' })}</p>
        <Panel tone="muted" padding="md">
          <p className="font-mono text-lg break-all text-foreground select-all" translate="no">{shared?.password}</p>
        </Panel>
        <p className="text-sm text-muted-foreground">{t('share.never')}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shared?.password ?? '')
                setCopied(true)
              } catch {
                setCopied(false)
              }
            }}
          >
            {copied ? t('share.copied') : t('share.copy')}
          </Button>
          <Button variant="primary" onClick={onClose}>{t('share.done')}</Button>
        </div>
      </div>
    </BottomSheet>
  )
}

/** One-field rename, shared by groups and documents. */
export function RenameSheet({
  title,
  label,
  initial,
  maxLength,
  onClose,
  onSave,
}: {
  title: string
  label: string
  initial: string | null
  maxLength: number
  onClose: () => void
  onSave: (value: string) => Promise<boolean>
}) {
  const t = useTranslations('clientDashboard.access')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each opening starts from the current name
    if (initial !== null) setValue(initial)
  }, [initial])
  const trimmed = value.trim()
  return (
    <BottomSheet open={initial !== null} title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!trimmed || busy) return
          setBusy(true)
          try {
            await onSave(trimmed)
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label={label}>{(p) => <TextInput {...p} autoFocus value={value} maxLength={maxLength} onChange={(e) => setValue(e.target.value)} />}</Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!trimmed || busy}>{busy ? t('saving') : t('save')}</Button>
        </div>
      </form>
    </BottomSheet>
  )
}
