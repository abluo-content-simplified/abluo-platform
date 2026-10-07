'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { ConfirmDialog } from '@/components/client/create/ConfirmDialog'
import type { CardMenuItem } from '@/components/client/ui/CardMenu'
import type { FilterChip } from '@/components/client/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/client/ui/ListToolbar'
import { PageHeader } from '@/components/client/ui/PageHeader'
import { Toast } from '@/components/client/ui/Toast'
import { useUndo } from '@/components/client/ui/use-undo'
import { permissionMessageKey } from '@/lib/authz/permissions'
import type { PeopleView, Person } from '@/lib/people/service'
import {
  applyPeopleFilters,
  DEFAULT_PEOPLE_FILTERS,
  displayName,
  isDefaultPeopleFilters,
  nextPeopleSort,
  type PeopleFilters,
  type PeopleStatusFilter,
} from '@/lib/client/people-filter'
import {
  archivePersonAction,
  cancelInvitationAction,
  invitePersonAction,
  resendInvitationAction,
  restorePersonAction,
  updatePersonAction,
  type PeopleActionResult,
} from '@/app/[locale]/(client)/[tenant]/people/actions'
import { PEOPLE_ICONS } from './people-bits'
import { InviteSheet, PersonSheet, SheetAction } from './PeopleSheets'
import { PeoplePhoneList, PeopleTable } from './PeopleTable'

const STATUS_FILTERS: PeopleStatusFilter[] = ['current', 'active', 'invited', 'archived', 'all']
const ERRORS = ['invalid_email', 'invalid_role', 'forbidden', 'not_found', 'invalid', 'too_soon'] as const

/**
 * The People list — built on the shared list pattern (PageHeader, ListToolbar,
 * DataTable on computers, cards on phones, CardMenu, BottomSheet, Toast), like
 * Posts. One list for everyone: active people, invitations (invited / expired)
 * and archived people. People are archived, never deleted. Every action is
 * re-checked on the server; the menu only offers what the viewer may do.
 */
export function PeopleBrowser({ title, projectSlug, locale, view }: { title: string; projectSlug: string; locale: string; view: PeopleView }) {
  const t = useTranslations('clientDashboard.people')
  const router = useRouter()
  const { toast, show } = useUndo()

  const [filters, setFilters] = useState<PeopleFilters>(DEFAULT_PEOPLE_FILTERS)
  const update = (patch: Partial<PeopleFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const reset = () => setFilters((f) => ({ ...DEFAULT_PEOPLE_FILTERS, sort: f.sort }))
  const shown = useMemo(() => applyPeopleFilters(view.people, filters), [view.people, filters])

  const [inviting, setInviting] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<Person | null>(null)
  const [busy, setBusy] = useState(false)
  const opened = view.people.find((p) => p.key === openKey) ?? null

  const roleLabel = (role: string) => t(`roles.${role}` as 'roles.editor')
  const extraLabel = (id: string) => t(`extras.${permissionMessageKey(id)}` as 'extras.formsSubmissionRead')
  const errorText = (code: string) => (ERRORS.includes(code as never) ? t(`errors.${code}` as 'errors.failed') : t('errors.failed'))

  /** Run an action; toast the outcome; refresh the list. Returns whether it worked. */
  async function run(action: () => Promise<PeopleActionResult>, message: (r: Extract<PeopleActionResult, { ok: true }>) => string): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    try {
      const r = await action()
      if (!r.ok) {
        show({ message: errorText(r.error), tone: 'error' })
        return false
      }
      show({ message: message(r), tone: 'status' })
      router.refresh()
      return true
    } catch {
      show({ message: t('errors.failed'), tone: 'error' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const base = { projectSlug, locale }
  const resend = (p: Person) =>
    run(
      () => resendInvitationAction({ ...base, invitationId: p.invitationId! }),
      (r) => (r.emailSent === false ? t('sentNoEmail') : t('resent', { email: p.email }))
    )
  const cancel = (p: Person) => run(() => cancelInvitationAction({ ...base, invitationId: p.invitationId! }), () => t('cancelled'))
  const restore = (p: Person) =>
    run(
      () => restorePersonAction({ ...base, archiveId: p.archiveId! }),
      () => t('restored', { name: displayName(p) })
    )
  const archive = async (p: Person) => {
    const ok = await run(() => archivePersonAction({ ...base, membershipId: p.membershipId! }), () => t('archived', { name: displayName(p) }))
    if (ok) setOpenKey(null)
    setConfirmArchive(null)
  }

  const menuFor = (p: Person): CardMenuItem[] => {
    const items: CardMenuItem[] = []
    if (p.editableRoles.length) items.push({ key: 'edit', label: t('edit'), onSelect: () => setOpenKey(p.key) })
    else items.push({ key: 'details', label: t('details'), onSelect: () => setOpenKey(p.key) })
    if (p.canResend) items.push({ key: 'resend', label: t('resend'), onSelect: () => void resend(p) })
    if (p.canRestore) items.push({ key: 'restore', label: t('restore'), onSelect: () => void restore(p) })
    if (p.canCancel) items.push({ key: 'cancel', label: t('cancelInvite'), onSelect: () => void cancel(p), destructive: true })
    if (p.canArchive) items.push({ key: 'archive', label: t('archive'), onSelect: () => setConfirmArchive(p), destructive: true })
    return items
  }

  const sheetActions = (p: Person) => {
    const list = [
      p.canResend ? (
        <SheetAction key="resend" disabled={busy} onPress={() => void resend(p)}>
          {t('resend')}
        </SheetAction>
      ) : null,
      p.canRestore ? (
        <SheetAction key="restore" disabled={busy} onPress={() => void restore(p).then((ok) => ok && setOpenKey(null))}>
          {t('restore')}
        </SheetAction>
      ) : null,
      p.canCancel ? (
        <SheetAction key="cancel" destructive disabled={busy} onPress={() => void cancel(p).then((ok) => ok && setOpenKey(null))}>
          {t('cancelInvite')}
        </SheetAction>
      ) : null,
      p.canArchive ? (
        <SheetAction key="archive" destructive disabled={busy} onPress={() => setConfirmArchive(p)}>
          {t('archive')}
        </SheetAction>
      ) : null,
    ].filter(Boolean)
    return list.length ? list : null
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const roles = [...new Set(view.people.map((p) => p.role))]
  const count = (s: PeopleStatusFilter) => applyPeopleFilters(view.people, { ...filters, q: '', role: '', status: s }).length
  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: STATUS_FILTERS.map((s) => ({ value: s, label: `${t(`filters.status_${s}`)} (${count(s)})` })),
      onChange: (v) => update({ status: v as PeopleStatusFilter }),
    },
  ]
  if (roles.length > 1) {
    selects.push({
      key: 'role',
      label: t('filters.role'),
      value: filters.role,
      options: [{ value: '', label: t('filters.roleAll') }, ...roles.map((r) => ({ value: r, label: roleLabel(r) }))],
      onChange: (v) => update({ role: v as PeopleFilters['role'] }),
    })
  }
  const chips: FilterChip[] = []
  if (filters.status !== DEFAULT_PEOPLE_FILTERS.status) chips.push({ id: 'status', label: t(`filters.status_${filters.status}`) })
  if (filters.role) chips.push({ id: 'role', label: roleLabel(filters.role) })
  const removeChip = (id: string) => update(id === 'status' ? { status: DEFAULT_PEOPLE_FILTERS.status } : { role: '' })
  const isDefault = isDefaultPeopleFilters(filters)

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        actions={
          view.invitableRoles.length > 0 ? (
            <button
              type="button"
              onClick={() => setInviting(true)}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {PEOPLE_ICONS.plus}
              {t('invite')}
            </button>
          ) : null
        }
      />

      <ListToolbar
        label={t('filters.filters')}
        search={{ value: filters.q, onChange: (q) => update({ q }), label: t('filters.search'), placeholder: t('filters.searchPlaceholder') }}
        filters={selects}
        summary={t('filters.showing', { shown: shown.length, total: view.people.length })}
        clear={{ label: t('filters.clear'), onClear: reset, visible: !isDefault }}
        sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: removeChip }}
      />

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10">
          <p className="font-medium text-foreground">{view.people.length ? t('filters.noMatch') : t('empty')}</p>
          {!isDefault ? (
            <button
              type="button"
              onClick={reset}
              className="mt-3 inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('filters.clear')}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <PeopleTable
              people={shown}
              roleLabel={roleLabel}
              extraLabel={extraLabel}
              sort={filters.sort}
              onSort={(c) => update({ sort: nextPeopleSort(c, filters.sort) })}
              onOpen={(p) => setOpenKey(p.key)}
              menuFor={menuFor}
            />
          </div>
          <div className="md:hidden">
            <PeoplePhoneList people={shown} roleLabel={roleLabel} extraLabel={extraLabel} onOpen={(p) => setOpenKey(p.key)} menuFor={menuFor} />
          </div>
        </>
      )}

      <InviteSheet
        open={inviting}
        onClose={() => setInviting(false)}
        roles={view.invitableRoles}
        extras={view.grantableExtras}
        extrasForRole={view.extrasForRole}
        roleLabel={roleLabel}
        extraLabel={extraLabel}
        onSubmit={async (email, role, extras) => {
          const ok = await run(
            () => invitePersonAction({ ...base, email, role, extras }),
            (r) => (r.emailSent === false ? t('sentNoEmail') : t('sent', { email }))
          )
          if (ok) setInviting(false)
          return ok
        }}
      />

      <PersonSheet
        person={opened}
        extras={view.grantableExtras}
        extrasForRole={view.extrasForRole}
        roleLabel={roleLabel}
        extraLabel={extraLabel}
        onClose={() => setOpenKey(null)}
        onSave={async (p, role, extras) => {
          const ok = await run(() => updatePersonAction({ ...base, membershipId: p.membershipId!, role, extras }), () => t('saved'))
          if (ok) setOpenKey(null)
          return ok
        }}
        actions={opened ? sheetActions(opened) : null}
      />

      <ConfirmDialog
        open={confirmArchive !== null}
        title={t('archiveConfirm.title', { name: confirmArchive ? displayName(confirmArchive) : '' })}
        body={t('archiveConfirm.body')}
        confirmLabel={t('archive')}
        busy={busy}
        onConfirm={() => confirmArchive && void archive(confirmArchive)}
        onCancel={() => setConfirmArchive(null)}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
