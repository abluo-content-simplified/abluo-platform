'use client'

import { useSyncExternalStore } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import { isActiveNow } from '@/lib/presence/model'
import type { AdminPerson, PersonAccess, PersonStatus } from '@/lib/admin/users-model'

const TONE: Record<PersonStatus, PillTone> = { active: 'success', invited: 'highlight', archived: 'muted', none: 'outline' }

/** Active / Invited / Archived / No access. */
export function UserStatusPill({ status }: { status: PersonStatus }) {
  const t = useTranslations('admin.users.status')
  return <Pill tone={TONE[status]}>{t(status)}</Pill>
}

export function SuperAdminPill() {
  const t = useTranslations('admin.users')
  return <Pill tone="outline">{t('superAdmin')}</Pill>
}

const DOT = <span aria-hidden="true" className="size-2 rounded-full bg-success" />

/** "Active now" (green dot) or "23 Oct, 14:32" in the reader's time zone; "Never" without any sign of life. */
export function LastActive({ iso, now }: { iso: string | null; now: number }) {
  const t = useTranslations('admin.users')
  const when = useLocalDateTime(iso)
  if (!iso) return <span className="text-sm leading-6 text-muted-foreground">{t('never')}</span>
  if (isActiveNow(iso, now)) return <Pill tone="success" icon={DOT}>{t('activeNow')}</Pill>
  return (
    <time dateTime={iso} className="text-sm leading-6 text-foreground">
      {when}
    </time>
  )
}

/** Date and time in the reader's zone (server render: UTC, written out — never silently wrong). */
export function useLocalDateTime(iso: string | null): string {
  const format = useFormatter()
  const zone = useSyncExternalStore(noSubscribe, browserZone, () => null)
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return format.dateTime(d, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: zone ?? 'UTC', ...(zone ? {} : { timeZoneName: 'short' }) })
}

const noSubscribe = () => () => {}
function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** Role name for any stored role (owner, member, admin, editor, viewer…); unknown roles show as stored. */
export function useRoleLabel() {
  const t = useTranslations('admin.users.roles')
  return (role: string) => (t.has(role) ? t(role) : role)
}

/** Live access (not archived), for the list's Access column. */
export const liveAccess = (p: AdminPerson): PersonAccess[] => p.access.filter((a) => a.status !== 'archived')

/** "Studio Martegani · Owner", "3 sites · mixed roles", or "—". */
export function AccessSummary({ person }: { person: AdminPerson }) {
  const t = useTranslations('admin.users')
  const role = useRoleLabel()
  const live = liveAccess(person)
  if (!live.length) return <span className="text-sm leading-6 text-muted-foreground">{person.access.length ? t('accessArchivedOnly') : '—'}</span>
  if (live.length === 1) {
    const a = live[0]
    return (
      <span className="flex flex-col items-start text-sm leading-6">
        <span className="line-clamp-1 text-foreground">{a.placeName || '—'}</span>
        <span className="text-muted-foreground">
          {role(a.role)}
          {a.status === 'invited' ? ` · ${t('status.invited')}` : ''}
        </span>
      </span>
    )
  }
  const roles = new Set(live.map((a) => a.role))
  return (
    <span className="flex flex-col items-start text-sm leading-6">
      <span className="text-foreground">{t('placesCount', { count: live.length })}</span>
      <span className="text-muted-foreground">{roles.size === 1 ? role([...roles][0]) : t('mixedRoles')}</span>
    </span>
  )
}

export const userHref = (key: string) => `/users/${encodeURIComponent(key)}`
