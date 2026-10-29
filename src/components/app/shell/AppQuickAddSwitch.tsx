'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Switch } from '@/components/app/ui/Switch'
import { appQuickAddCookie } from '@/lib/app-theme'
import { useQuickAdd } from './QuickAddContext'

/**
 * "Show quick add button": the floating "+" on iPad and computers (on by
 * default). Phones always show it. Writes the `abluo_quick_add` cookie, flips
 * the "+" at once through the dashboard's context and refreshes the layout so
 * the page's bottom room follows. Inside the client dashboard it needs no
 * `initial`; on the account page pass the cookie's value.
 */
export function AppQuickAddSwitch({ initial = true }: { initial?: boolean }) {
  const t = useTranslations('app.quickAdd')
  const router = useRouter()
  const shared = useQuickAdd()
  const [own, setOwn] = useState(initial)
  const id = useId()
  const on = shared ? shared.value : own

  function change(next: boolean) {
    setOwn(next)
    shared?.set(next)
    writeCookie(appQuickAddCookie(next))
    router.refresh()
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p id={id} className="text-sm font-medium text-foreground">
          {t('label')}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      <Switch checked={on} onChange={change} labelledBy={id} />
    </div>
  )
}

/** Module-level so the React compiler doesn't treat it as mutating render state. */
function writeCookie(value: string) {
  document.cookie = value
}
