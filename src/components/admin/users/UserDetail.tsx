'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Avatar } from '@/components/app/ui/Avatar'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import { Panel } from '@/components/app/ui/Panel'
import { Tabs, tabPanelProps } from '@/components/app/ui/Tabs'
import { Chips, Pill } from '@/components/app/ui/list/cells'
import { TwoFactorPill } from '@/components/client/people/people-bits'
import type { AdminPerson, PersonAccess, UserActivityItem } from '@/lib/admin/users-model'
import { LastActive, SuperAdminPill, useLocalDateTime, useRoleLabel, UserStatusPill } from './users-bits'

type Tab = 'profile' | 'access' | 'security' | 'activity'

/**
 * One person (ADR-030 A1): Profile · Access · Security · Activity, read-only.
 * Changing someone's access still happens on the site's People page; actions
 * here come in a later slice.
 */
export function UserDetail({ person, activity, now }: { person: AdminPerson; activity: UserActivityItem[]; now: number }) {
  const t = useTranslations('admin.users')
  const idBase = useId()
  const [tab, setTab] = useState<Tab>('profile')
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <Avatar name={person.name} email={person.email} src={person.avatarUrl} size="lg" muted={person.status !== 'active'} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[1.5rem] leading-8 font-semibold tracking-tight break-words">{person.name || person.email}</h1>
          {person.name ? <p className="text-sm leading-5 break-all text-muted-foreground">{person.email}</p> : null}
          <span className="flex flex-wrap items-center gap-2 pt-1">
            <UserStatusPill status={person.status} />
            {person.superAdmin ? <SuperAdminPill /> : null}
            <LastActive iso={person.lastActiveAt} now={now} />
          </span>
        </div>
      </div>

      <Tabs
        label={t('detail.tabsLabel')}
        idBase={idBase}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        items={[
          { id: 'profile', label: t('detail.tabs.profile') },
          { id: 'access', label: t('detail.tabs.access'), count: person.access.length },
          { id: 'security', label: t('detail.tabs.security') },
          { id: 'activity', label: t('detail.tabs.activity') },
        ]}
      />
      <div {...tabPanelProps(idBase, tab)}>
        {tab === 'profile' ? <ProfileTab person={person} /> : null}
        {tab === 'access' ? <AccessTab person={person} /> : null}
        {tab === 'security' ? <SecurityTab person={person} now={now} /> : null}
        {tab === 'activity' ? <ActivityTab items={activity} /> : null}
      </div>
    </div>
  )
}

function When({ iso }: { iso: string | null }) {
  const t = useTranslations('admin.users')
  const text = useLocalDateTime(iso)
  return iso ? <time dateTime={iso}>{text}</time> : <span className="text-muted-foreground">{t('never')}</span>
}

function ProfileTab({ person }: { person: AdminPerson }) {
  const t = useTranslations('admin.users.detail')
  return (
    <Panel>
      <dl>
        <FactRow label={t('name')}>{person.name || '—'}</FactRow>
        <FactRow label={t('email')}>{person.email}</FactRow>
        <FactRow label={t('platformRole')}>{person.superAdmin ? <SuperAdminPill /> : t('noPlatformRole')}</FactRow>
        <FactRow label={t('accountCreated')}>{person.userId ? <When iso={person.createdAt} /> : t('noAccountYet')}</FactRow>
      </dl>
    </Panel>
  )
}

const ACCESS_TONE = { active: 'success', invited: 'highlight', archived: 'muted' } as const

function AccessTab({ person }: { person: AdminPerson }) {
  const t = useTranslations('admin.users')
  const role = useRoleLabel()
  const tExtras = useTranslations('clientDashboard.people.extras')
  const extra = (id: string) => {
    const key = id.replace(/\.(\w)/g, (_, c: string) => c.toUpperCase())
    return tExtras.has(key) ? tExtras(key) : id
  }
  if (!person.access.length) return <EmptyState titleAs="p" title={person.superAdmin ? t('detail.accessSuperAdminOnly') : t('detail.noAccess')} />
  return (
    <Panel>
      <dl>
        {person.access.map((a: PersonAccess) => (
          <FactRow key={`${a.scope}:${a.placeId}:${a.status}`} label={a.placeName || '—'}>
            <span className="flex flex-col items-end gap-1">
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span>{a.scope === 'tenant' ? t('detail.wholeClient', { role: role(a.role) }) : role(a.role)}</span>
                <Pill tone={ACCESS_TONE[a.status]}>{t(`status.${a.status}`)}</Pill>
              </span>
              {a.extras.length ? <Chips items={a.extras.map(extra)} /> : null}
            </span>
          </FactRow>
        ))}
      </dl>
    </Panel>
  )
}

function SecurityTab({ person, now }: { person: AdminPerson; now: number }) {
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

function ActivityTab({ items }: { items: UserActivityItem[] }) {
  const t = useTranslations('admin.users.detail')
  if (!items.length) return <EmptyState titleAs="p" title={t('noActivity')} body={t('noActivityBody')} />
  return (
    <Panel>
      <ul className="flex flex-col">
        {items.map((i) => (
          <ActivityRow key={i.id} item={i} />
        ))}
      </ul>
    </Panel>
  )
}

function ActivityRow({ item }: { item: UserActivityItem }) {
  const t = useTranslations('admin.users.activity')
  const role = useRoleLabel()
  const when = useLocalDateTime(item.at)
  const other = item.other || t('someone')
  const text = (() => {
    switch (item.kind) {
      case 'content': {
        const type = t.has(`types.${item.contentType}`) ? t(`types.${item.contentType}`) : t('types.other')
        const action = t.has(`actions.${item.action}`) ? t(`actions.${item.action}`) : (item.action ?? '')
        return t('content', { type, action })
      }
      case 'access':
        return t(`about.${item.action === 'member.archive' ? 'archive' : item.action === 'member.restore' ? 'restore' : 'change'}`, { name: other, role: role(item.role ?? '') })
      case 'accessBy':
        return t(`by.${item.action === 'member.archive' ? 'archive' : item.action === 'member.restore' ? 'restore' : 'change'}`, { name: other, role: role(item.role ?? '') })
      case 'invited':
        return item.other ? t('invitedBy', { name: item.other, role: role(item.role ?? '') }) : t('invited', { role: role(item.role ?? '') })
      case 'joined':
        return t('joined', { role: role(item.role ?? '') })
      case 'inviteCancelled':
        return t('inviteCancelled')
    }
  })()
  return (
    <li className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0">
      <span className="flex flex-wrap items-start gap-2 text-[0.9375rem] leading-6 text-foreground">
        {text}
        {item.support ? <Pill tone="outline">{t('support')}</Pill> : null}
        {item.outcome && item.outcome !== 'ok' ? <Pill tone="outline">{t(`outcome.${item.outcome}`)}</Pill> : null}
      </span>
      <span className="text-sm leading-5 text-muted-foreground">
        {[item.place, when].filter(Boolean).join(' · ')}
      </span>
    </li>
  )
}
