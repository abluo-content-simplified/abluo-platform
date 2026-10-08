'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { Avatar } from '@/components/app/ui/Avatar'
import { LocalDate, Pill } from '@/components/app/ui/list/cells'
import type { Person } from '@/lib/people/service'
import { displayName } from '@/lib/client/people-filter'
import { StatusPill, TwoFactorPill } from './people-bits'

/** People list: the invite sheet and the person sheet (details, access, actions). */

export const PRIMARY_BTN =
  'inline-flex h-12 w-full items-center justify-center rounded-xl bg-action px-5 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40'
export const QUIET_BTN =
  'inline-flex h-12 w-full items-center justify-center rounded-xl px-5 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40'
const DANGER_BTN = `${QUIET_BTN.replace('text-foreground', 'text-destructive')}`
const INPUT =
  'mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function RoleChoice({ roles, value, onChange, roleLabel }: { roles: string[]; value: string; onChange: (r: string) => void; roleLabel: (r: string) => string }) {
  const t = useTranslations('clientDashboard.people')
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-[0.9375rem] font-medium text-foreground">{t('role')}</legend>
      {roles.map((r) => (
        <label
          key={r}
          className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 ${value === r ? 'border-action ring-1 ring-action' : 'border-border'}`}
        >
          <input type="radio" name="role" value={r} checked={value === r} onChange={() => onChange(r)} className="size-5 accent-action" />
          <span>
            <span className="block text-[0.9375rem] font-medium text-foreground">{roleLabel(r)}</span>
            <span className="block text-sm text-muted-foreground">{t(`roleHelp.${r}` as 'roleHelp.editor')}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

function ExtrasChoice({
  all,
  available,
  value,
  onChange,
  extraLabel,
}: {
  /** Everything the viewer may give on this site. */
  all: string[]
  /** What adds something for the chosen role. */
  available: string[]
  value: string[]
  onChange: (v: string[]) => void
  extraLabel: (id: string) => string
}) {
  const t = useTranslations('clientDashboard.people')
  if (!all.length) return null
  if (!available.length) return <p className="text-sm text-muted-foreground">{t('includedByRole')}</p>
  const toggle = (id: string, on: boolean) => {
    // "Manages contact requests" needs "Sees contact requests"; switching reading off switches both off.
    let next = on ? [...new Set([...value, id])] : value.filter((x) => x !== id)
    if (on && id === 'forms.submission.update') next = [...new Set([...next, 'forms.submission.read'])]
    if (!on && id === 'forms.submission.read') next = next.filter((x) => x !== 'forms.submission.update')
    onChange(next)
  }
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-[0.9375rem] font-medium text-foreground">{t('access')}</legend>
      {available.map((id) => (
        <label key={id} className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-foreground">
          <Checkbox checked={value.includes(id)} onChange={(on) => toggle(id, on)} aria-label={extraLabel(id)} />
          {extraLabel(id)}
        </label>
      ))}
    </fieldset>
  )
}

export function InviteSheet({
  open,
  onClose,
  roles,
  extras,
  extrasForRole,
  roleLabel,
  extraLabel,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  roles: string[]
  extras: string[]
  extrasForRole: Record<string, string[]>
  roleLabel: (r: string) => string
  extraLabel: (id: string) => string
  onSubmit: (email: string, role: string, extras: string[]) => Promise<boolean>
}) {
  const t = useTranslations('clientDashboard.people')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(roles.includes('editor') ? 'editor' : (roles[0] ?? ''))
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  return (
    <BottomSheet open={open} title={t('inviteTitle')} onClose={onClose}>
      <form
        className="flex flex-col gap-5 pt-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          const ok = await onSubmit(email, role, chosen.filter((x) => (extrasForRole[role] ?? []).includes(x)))
          setBusy(false)
          if (ok) {
            setEmail('')
            setChosen([])
          }
        }}
      >
        <label className="text-[0.9375rem] font-medium text-foreground">
          {t('email')}
          <input type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
        </label>
        <RoleChoice roles={roles} value={role} onChange={setRole} roleLabel={roleLabel} />
        <ExtrasChoice all={extras} available={extrasForRole[role] ?? []} value={chosen} onChange={setChosen} extraLabel={extraLabel} />
        <button type="submit" disabled={busy || !role} className={PRIMARY_BTN}>
          {busy ? t('sending') : t('send')}
        </button>
      </form>
    </BottomSheet>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 border-b border-border py-2 text-[0.9375rem] last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </div>
  )
}

/**
 * One person: who they are, the facts (status, invited by, joined, last
 * active, two-step), change access when the viewer may, and the actions the
 * viewer may take (resend, cancel, archive, restore). Owners and client
 * Members are read-only here.
 */
export function PersonSheet({
  person,
  extras,
  extrasForRole,
  roleLabel,
  extraLabel,
  onClose,
  onSave,
  actions,
}: {
  person: Person | null
  extras: string[]
  extrasForRole: Record<string, string[]>
  roleLabel: (r: string) => string
  extraLabel: (id: string) => string
  onClose: () => void
  onSave: (person: Person, role: string, extras: string[]) => Promise<boolean>
  /** Resend / Cancel / Archive / Restore buttons for this person (already filtered by what the viewer may do). */
  actions: ReactNode
}) {
  return (
    <BottomSheet open={person !== null} title={person ? displayName(person) : ''} onClose={onClose}>
      {person ? (
        <PersonSheetBody
          key={person.key}
          person={person}
          extras={extras}
          extrasForRole={extrasForRole}
          roleLabel={roleLabel}
          extraLabel={extraLabel}
          onSave={onSave}
          actions={actions}
        />
      ) : null}
    </BottomSheet>
  )
}

function PersonSheetBody({
  person,
  extras,
  extrasForRole,
  roleLabel,
  extraLabel,
  onSave,
  actions,
}: {
  person: Person
  extras: string[]
  extrasForRole: Record<string, string[]>
  roleLabel: (r: string) => string
  extraLabel: (id: string) => string
  onSave: (person: Person, role: string, extras: string[]) => Promise<boolean>
  actions: ReactNode
}) {
  const t = useTranslations('clientDashboard.people')
  const [role, setRole] = useState<string>(person.role)
  const [chosen, setChosen] = useState<string[]>(person.extras)
  const [busy, setBusy] = useState(false)
  const editable = person.editableRoles.length > 0
  const dirty = role !== person.role || [...chosen].sort().join() !== [...person.extras].sort().join()
  const date = (iso: string | null) => (iso ? <LocalDate iso={iso} /> : <span className="text-muted-foreground">—</span>)
  return (
    <div className="flex flex-col gap-5 pt-1">
      <div className="flex items-center gap-3">
        <Avatar name={person.name} email={person.email} src={person.avatarUrl} size="lg" muted={person.status !== 'active'} />
        <div className="min-w-0">
          {person.name ? <p className="truncate text-sm text-muted-foreground">{person.email}</p> : null}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <StatusPill status={person.status} />
            {person.isYou ? <Pill tone="outline">{t('you')}</Pill> : null}
          </div>
        </div>
      </div>

      <dl>
        <Fact label={t('role')}>{roleLabel(person.role)}</Fact>
        {person.kind === 'owner' ? <Fact label={t('detail.note')}>{t('ownerNote')}</Fact> : null}
        {person.kind === 'clientMember' ? <Fact label={t('detail.note')}>{t('clientMemberNote')}</Fact> : null}
        {person.extras.length && !editable ? <Fact label={t('access')}>{person.extras.map(extraLabel).join(', ')}</Fact> : null}
        {person.invitedBy ? <Fact label={t('detail.invitedBy')}>{person.invitedBy}</Fact> : null}
        {person.invitedAt ? <Fact label={t('detail.invitedOn')}>{date(person.invitedAt)}</Fact> : null}
        {person.status === 'invited' ? <Fact label={t('detail.validUntil')}>{date(person.expiresAt)}</Fact> : null}
        {person.status === 'expired' ? <Fact label={t('detail.expiredOn')}>{date(person.expiresAt)}</Fact> : null}
        {person.joinedAt ? <Fact label={t('detail.joined')}>{date(person.joinedAt)}</Fact> : null}
        {person.archivedAt ? <Fact label={t('detail.archivedOn')}>{date(person.archivedAt)}</Fact> : null}
        {person.kind !== 'invitation' ? (
          <Fact label={t('detail.lastActive')}>{person.lastActiveAt ? date(person.lastActiveAt) : <span className="text-muted-foreground">{t('detail.never')}</span>}</Fact>
        ) : null}
        {person.twoFactor !== null ? (
          <Fact label={t('detail.twoFactor')}>
            <TwoFactorPill on={person.twoFactor} />
          </Fact>
        ) : null}
      </dl>

      {editable ? (
        <>
          <RoleChoice roles={person.editableRoles} value={role} onChange={setRole} roleLabel={roleLabel} />
          <ExtrasChoice all={extras} available={extrasForRole[role] ?? []} value={chosen} onChange={setChosen} extraLabel={extraLabel} />
          <button
            type="button"
            disabled={busy || !dirty}
            className={PRIMARY_BTN}
            onClick={async () => {
              setBusy(true)
              await onSave(person, role, chosen.filter((x) => (extrasForRole[role] ?? []).includes(x)))
              setBusy(false)
            }}
          >
            {t('save')}
          </button>
        </>
      ) : null}

      {actions ? <div className="flex flex-col gap-1">{actions}</div> : null}
    </div>
  )
}

export function SheetAction({ children, onPress, disabled, destructive }: { children: ReactNode; onPress: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <button type="button" onClick={onPress} disabled={disabled} className={destructive ? DANGER_BTN : QUIET_BTN}>
      {children}
    </button>
  )
}
