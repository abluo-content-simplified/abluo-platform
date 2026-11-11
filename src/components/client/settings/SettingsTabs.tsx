'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { usePathname, useRouter } from '@/i18n/navigation'
import { Tabs } from '@/components/app/ui/Tabs'
import { useClientNav } from '@/components/client/nav-context'
import { resolveActiveNavId } from '@/lib/modules/client-nav-layout'

/**
 * The Settings area's top tabs (Tom, 2026-11-11): General · Users · Social
 * Profiles · Connected Apps · Billing · Labels — only those this person may
 * open. The one shared Tabs component; each tab is its own page (deep link).
 * Hidden when there is only one.
 */
export function SettingsTabs() {
  const t = useTranslations('clientDashboard.settingsTabs')
  const { settings } = useClientNav()
  const pathname = usePathname()
  const router = useRouter()
  if (settings.length < 2) return null
  const active = resolveActiveNavId(pathname, settings.map((s) => ({ moduleId: s.id, href: s.href, labelKey: '', group: 'project' as const }))) ?? settings[0].id
  return (
    <Tabs
      label={t('label')}
      value={active}
      onChange={(id) => {
        const href = settings.find((s) => s.id === id)?.href
        if (href) router.push(href)
      }}
      items={settings.map((s) => ({ id: s.id, label: t(s.id as 'settings') }))}
    />
  )
}

/**
 * The top of every Settings page: "Settings" and the tabs. A person who can
 * open only one of them sees that page under its own title (`ownTitle`), no tabs.
 */
export function SettingsHeader({ ownTitle, actions }: { ownTitle: string; actions?: ReactNode }) {
  const t = useTranslations('clientDashboard.settingsTabs')
  const { settings } = useClientNav()
  const tabbed = settings.length > 1
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={tabbed ? t('title') : ownTitle} actions={actions} />
      <SettingsTabs />
    </div>
  )
}
