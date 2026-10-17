'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'

type Theme = 'light' | 'dark'
type Surface = 'manage' | 'admin' | 'create'
type Width = 'full' | 'phone'

/**
 * The Lab's preview frame. A nested `.abluo-app` element re-declares the App
 * tokens, so theme and surface switch for the canvas only — never the admin's
 * own cookie. Text size is not offered: it scales the whole page (html:has).
 * Overlays (sheets, dialogs, menus) portal to the outer app root, so they
 * follow the admin's own theme.
 */
export function DemoCanvas({ children }: { children: ReactNode }) {
  const t = useTranslations('admin.lab.canvas')
  const [theme, setTheme] = useState<Theme>('light')
  const [surface, setSurface] = useState<Surface>('manage')
  const [width, setWidth] = useState<Width>('full')

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('label')} className="flex flex-wrap items-start gap-3">
        <SegmentedControl label={t('theme')} appearance="soft" value={theme} onChange={setTheme} options={[{ value: 'light', label: t('light') }, { value: 'dark', label: t('dark') }]} />
        <SegmentedControl
          label={t('surface')}
          appearance="soft"
          value={surface}
          onChange={setSurface}
          options={[
            { value: 'manage', label: t('manage') },
            { value: 'admin', label: t('admin') },
            { value: 'create', label: t('create') },
          ]}
        />
        <SegmentedControl label={t('width')} appearance="soft" value={width} onChange={setWidth} options={[{ value: 'full', label: t('full') }, { value: 'phone', label: t('phone') }]} />
      </div>
      <div
        className={`abluo-app rounded-2xl border border-border p-4 md:p-6 ${width === 'phone' ? 'max-w-[390px]' : 'w-full'}`}
        data-theme={theme}
        data-surface={surface}
      >
        {children}
      </div>
    </div>
  )
}
