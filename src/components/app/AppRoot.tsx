import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { Inter } from 'next/font/google'
import {
  APP_TEXT_SIZE_COOKIE,
  APP_THEME_COOKIE,
  appTextSizeAttribute,
  appThemeAttribute,
  parseAppTextSize,
  parseAppTheme,
} from '@/lib/app-theme'

/**
 * The `.abluo-app` root of every Abluo App surface (ADR-025 D7, shared since
 * ADR-030): the client dashboard's `(client)` layout and the admin's `(admin)`
 * layout both render their frame inside it.
 *
 * The App tokens are scoped to this element (globals.css), so tenant websites
 * are untouched. Theme and text size come from the `abluo-app-theme` /
 * `abluo-app-text` cookies and are rendered on the server, so the first paint
 * is already right (no boot script, no flash). Inter is loaded here only —
 * tenant websites never download it.
 *
 * `surface` names the frame (`manage` = client dashboard, `admin`), so CSS can
 * tell them apart if they ever need to diverge without forking a component.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-app', display: 'swap' })

export async function AppRoot({ surface, children }: { surface: string; children: ReactNode }) {
  const jar = await cookies()
  const theme = parseAppTheme(jar.get(APP_THEME_COOKIE)?.value)
  const textSize = parseAppTextSize(jar.get(APP_TEXT_SIZE_COOKIE)?.value)

  return (
    <div
      className={`abluo-app ${inter.variable} min-h-screen`}
      data-theme={appThemeAttribute(theme)}
      data-text-size={appTextSizeAttribute(textSize)}
      data-surface={surface}
    >
      {children}
    </div>
  )
}
