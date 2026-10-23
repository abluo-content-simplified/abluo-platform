'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Avatar } from '@/components/app/ui/Avatar'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellChips, CellPill, CellText, Chips, Pill } from '@/components/app/ui/list/cells'
import { TwoFactorPill } from '@/components/client/people/people-bits'
import type { AdminPerson, PersonAccess, UserActivityItem } from '@/lib/admin/users-model'
import { LastActive, SuperAdminPill, useExtraLabel, useLocalDateTime, useRoleLabel, UserStatusPill } from './users-bits'

/**
 * One person (ADR-030 A1), read-only, all on one page: Profile and Security
 * cards side by side, then Access and Activity as Records lists (DataTable on
 * computers, ListRow on phones — the same parts as the Users list). Changing
 * someone's access still happens on the site's People page.
 */
export function UserDetail({ person, activity, now, actions, note }: { person: AdminPerson; activity: UserActivityItem[]; now: number; actions?: ReactNode; note?: ReactNode }) {
  const t = useTranslations('admin.users.detail')
  return (
    <>
      <div className="space-y-1">
        <PageHeader title={person.name || person.email} actions={actions} />
        {note}
      </div>

      <div className="grid items-start gap-5 md:grid-cols-2">
        <section aria-labelledby="user-profile" className="flex flex-col gap-3">
          <SectionHeading id="user-profile" title={t('tabs.profile')} />
          <ProfileCard person={person} now={now} />
        </section>
        <section aria-labelledby="user-security" className="flex flex-col gap-3">
          <SectionHeading id="user-security" title={t('tabs.security')} />
          <SecurityCard person={person} now={now} />
        </section>
      </div>

      <section aria-labelledby="user-access" className="flex flex-col gap-3">
        <SectionHeading id="user-access" title={t('tabs.access')} />
        <AccessList person={person} />
      </section>

      <section aria-labelledby="user-activity" className="flex flex-col gap-3">
        <SectionHeading id="user-activity" title={t('tabs.activity')} />
        <ActivityList person={person} items={activity} />
      </section>
    </>
  )
}

function When({ iso }: { iso: string | null }) {
  const t = useTranslations('admin.users')
  const text = useLocalDateTime(iso)
  return iso ? <time dateTime={iso}>{text}</time> : <span className="text-muted-foreground">{t('never')}</span>
}

function ProfileCard({ person, now }: { person: AdminPerson; now: number }) {
  const t = useTranslations('admin.users.detail')
  const invitedSince = person.access.filter((a) => a.status === 'invited' && a.since).map((a) => a.since as string).sort()[0] ?? null
  return (
    <Panel>
      <div className="flex items-start gap-4 pb-3">
        <Avatar name={person.name} email={person.email} src={person.avatarUrl} size="lg" muted={person.status !== 'active'} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-base leading-6 font-semibold break-words">{person.name || person.email}</p>
          {person.name ? <p className="text-sm leading-5 break-all text-muted-foreground">{person.email}</p> : null}
          <span className="flex flex-wrap items-start gap-2 pt-1">
            <UserStatusPill status={person.status} />
            {person.superAdmin ? <SuperAdminPill /> : null}
          </span>
        </div>
      </div>
      <dl>
        <FactRow label={t('name')}>{person.name || '—'}</FactRow>
        <FactRow label={t('email')}>{person.email}</FactRow>
        <FactRow label={t('platformRole')}>{person.superAdmin ? <SuperAdminPill /> : t('noPlatformRole')}</FactRow>
        <FactRow label={t('lastActive')}>
          <LastActive iso={person.lastActiveAt} now={now} />
        </FactRow>
        <FactRow label={t('accountCreated')}>{person.userId ? <When iso={person.createdAt} /> : t('noAccountYet')}</FactRow>
        {invitedSince ? (
          <FactRow label={t('invitedOn')}>
            <When iso={invitedSince} />
          </FactRow>
        ) : null}
      </dl>
    </Panel>
  )
}

function SecurityCard({ person, now }: { person: AdminPerson; now: number }) {
  const t = useTranslations('admin.users.detail')
  if (!person.userId) return <EmptyState titleAs="p" title={t('noAccountYet')} />
  return (
    <Panel>
      <dl>
        <FactRow label={t('twoFactor')}>{person.twoFactor === null ? '—' : <TwoFactorPill on={person.twoFactor} />}</FactRow>
        <FactRow label={t('lastSignIn')}>
          <When iso={person.lastSignInAt} />
        </FactRow>
        <FactRow label={t('lastActive')}>
          <LastActive iso={person.lastActiveAt} now={now} />
        </FactRow>
      </dl>
    </Panel>
  )
}

const ACCESS_TONE = { active: 'success', invited: 'highlight', archived: 'muted' } as const
const accessKey = (a: PersonAccess) => `${a.scope}:${a.placeId}:${a.status}`

function AccessStatus({ a }: { a: PersonAccess }) {
  const t = useTranslations('admin.users.status')
  return <Pill tone={ACCESS_TONE[a.status]}>{t(a.status)}</Pill>
}

function AccessRole({ a }: { a: PersonAccess }) {
  const role = useRoleLabel()
  return <>{role(a.role)}</>
}

function AccessExtras({ a, empty }: { a: PersonAccess; empty?: boolean }) {
  const extra = useExtraLabel()
  const items = a.extras.map(extra)
  return empty ? <CellChips items={items} /> : <Chips items={items} />
}

function AccessSince({ a }: { a: PersonAccess }) {
  const text = useLocalDateTime(a.since)
  return a.since ? (
    <time dateTime={a.since} className="text-sm leading-6 text-muted-foreground">
      {text}
    </time>
  ) : (
    <span className="text-sm leading-6 text-muted-foreground">—</span>
  )
}

function AccessList({ person }: { person: AdminPerson }) {
  const t = useTranslations('admin.users')
  if (!person.access.length) return <EmptyState titleAs="p" title={person.superAdmin ? t('detail.accessSuperAdminOnly') : t('detail.noAccess')} />
  const place = (a: PersonAccess) => <CellText clamp={1} primary={a.placeName || '—'} secondary={a.scope === 'tenant' ? t('detail.wholeClientShort') : null} />
  const columns: DataTableColumn<PersonAccess>[] = [
    { key: 'place', header: t('detail.columns.site'), width: 'min-w-56', render: place },
    { key: 'role', header: t('detail.columns.role'), width: 'w-36', render: (a) => <span className="text-sm leading-6 text-foreground"><AccessRole a={a} /></span> },
    { key: 'extras', header: t('detail.columns.extras'), width: 'min-w-48', render: (a) => <AccessExtras a={a} empty /> },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-32',
      render: (a) => (
        <CellPill>
          <AccessStatus a={a} />
        </CellPill>
      ),
    },
    { key: 'since', header: t('detail.columns.since'), width: 'w-48', className: 'whitespace-nowrap', render: (a) => <AccessSince a={a} /> },
  ]
  return (
    <>
      <div className="hidden md:block">
        <DataTable label={t('detail.tabs.access')} rows={person.access} columns={columns} rowKey={accessKey} minWidth="min-w-[48rem]" />
      </div>
      <ul aria-label={t('detail.tabs.access')} className="flex flex-col gap-3 md:hidden">
        {person.access.map((a) => (
          <ListRow key={accessKey(a)}>
            <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{a.placeName || '—'}</span>
            <span className="flex flex-wrap items-start gap-2 text-sm leading-6 text-muted-foreground">
              <AccessRole a={a} />
              {a.scope === 'tenant' ? <span>· {t('detail.wholeClientShort')}</span> : null}
              <AccessStatus a={a} />
            </span>
            <AccessExtras a={a} />
            <AccessSince a={a} />
          </ListRow>
        ))}
      </ul>
    </>
  )
}

function ActivityWhat({ item }: { item: UserActivityItem }) {
  const t = useTranslations('admin.users.activity')
  const role = useRoleLabel()
  const other = item.other || t('someone')
  const kind = item.action === 'member.archive' ? 'archive' : item.action === 'member.restore' ? 'restore' : 'change'
  const text = (() => {
    switch (item.kind) {
      case 'content': {
        const type = t.has(`types.${item.contentType}`) ? t(`types.${item.contentType}`) : t('types.other')
        const action = t.has(`actions.${item.action}`) ? t(`actions.${item.action}`) : (item.action ?? '')
        return t('content', { type, action })
      }
      case 'access':
        return t(`what.${kind}`, { role: role(item.role ?? '') })
      case 'accessBy':
        return t(`by.${kind}`, { name: other, role: role(item.role ?? '') })
      case 'invited':
        return t('invited', { role: role(item.role ?? '') })
      case 'joined':
        return t('joined', { role: role(item.role ?? '') })
      case 'inviteCancelled':
        return t('inviteCancelled')
    }
  })()
  return (
    <span className="flex flex-wrap items-start gap-2 text-sm leading-6 text-foreground">
      {text}
      {item.outcome && item.outcome !== 'ok' ? <Pill tone="outline">{t(`outcome.${item.outcome}`)}</Pill> : null}
    </span>
  )
}

/** Who did it: the other person when someone else changed this person's access / invited them; otherwise the person themselves. */
function ActivityBy({ item, self }: { item: UserActivityItem; self: string }) {
  const t = useTranslations('admin.users.activity')
  const name = item.kind === 'access' || item.kind === 'invited' ? item.other || null : item.kind === 'inviteCancelled' ? null : self
  return (
    <span className="flex flex-wrap items-start gap-2 text-sm leading-6 text-foreground">
      {name ?? <span className="text-muted-foreground">—</span>}
      {item.support ? <Pill tone="outline">{t('support')}</Pill> : null}
    </span>
  )
}

function ActivityWhen({ iso }: { iso: string }) {
  const text = useLocalDateTime(iso)
  return (
    <time dateTime={iso} className="text-sm leading-6 text-muted-foreground">
      {text}
    </time>
  )
}

function ActivityList({ person, items }: { person: AdminPerson; items: UserActivityItem[] }) {
  const t = useTranslations('admin.users.detail')
  const self = person.name || person.email
  if (!items.length) return <EmptyState titleAs="p" title={t('noActivity')} body={t('noActivityBody')} />
  const columns: DataTableColumn<UserActivityItem>[] = [
    { key: 'when', header: t('columns.when'), width: 'w-48', className: 'whitespace-nowrap', render: (i) => <ActivityWhen iso={i.at} /> },
    { key: 'what', header: t('columns.what'), width: 'min-w-64', render: (i) => <ActivityWhat item={i} /> },
    { key: 'where', header: t('columns.where'), width: 'w-48', render: (i) => <span className="text-sm leading-6 text-foreground">{i.place || '—'}</span> },
    { key: 'by', header: t('columns.by'), width: 'w-48', render: (i) => <ActivityBy item={i} self={self} /> },
  ]
  return (
    <>
      <div className="hidden md:block">
        <DataTable label={t('tabs.activity')} rows={items} columns={columns} rowKey={(i) => i.id} minWidth="min-w-[48rem]" />
      </div>
      <ul aria-label={t('tabs.activity')} className="flex flex-col gap-3 md:hidden">
        {items.map((i) => (
          <ListRow key={i.id}>
            <ActivityWhat item={i} />
            {i.place ? <span className="text-sm leading-5 text-muted-foreground">{i.place}</span> : null}
            <ActivityWhen iso={i.at} />
            <span className="flex flex-wrap items-start gap-1 text-sm leading-5 text-muted-foreground">
              {t('columns.by')}: <ActivityBy item={i} self={self} />
            </span>
          </ListRow>
        ))}
      </ul>
    </>
  )
}
