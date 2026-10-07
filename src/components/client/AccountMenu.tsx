'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppTextSizeSwitch } from './AppTextSizeSwitch'
import { AppThemeSwitch } from './AppThemeSwitch'
import { AppVersion } from './AppVersion'
import { SignOutButton } from './account/SignOutButton'
import { Avatar } from './ui/Avatar'
import { BottomSheet } from './ui/BottomSheet'
import { FLOATING_STYLE, portalTarget, useAnchoredPopover } from './ui/anchored-popover'
import type { AppTextSize, AppTheme } from '@/lib/app-theme'

/**
 * The signed-in person's own menu (ADR-029 §1, "user-level preferences ≠
 * project configuration"): Account · Appearance · Text size · Help · Sign out,
 * and the app version quietly at the bottom. Nothing in here changes the
 * project — it only affects this person's CMS experience.
 *
 * Two triggers, one content, designed per device (not one responsive blob):
 *   • `variant="sidebar"` (desktop): the avatar + name at the bottom of the
 *     sidebar; the menu opens as a popover anchored to it (opens upward when
 *     there is no room below).
 *   • `variant="bar"` (phone): the avatar button at the right of the top bar;
 *     the menu opens as a bottom sheet. Rows are ≥ 44px there.
 * The caller shows each variant only on its device (`hidden md:block` /
 * `md:hidden`). The sheet's content mounts only while open, so the two copies
 * never put the same ids in the page twice.
 *
 * Help is configuration (`ABLUO_HELP_URL`, read on the server): no URL, no row.
 */
export type AccountMenuProps = {
  variant: 'sidebar' | 'bar'
  name: string
  email: string
  avatarUrl: string | null
  theme: AppTheme
  textSize: AppTextSize
  /** Where Help leads; null hides the row. */
  helpUrl: string | null
}

const ROW =
  'flex min-h-12 w-full items-start rounded-md px-3 py-3 text-left text-[0.9375rem] text-foreground transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none md:min-h-10 md:py-2.5'

function MenuBody({ name, email, theme, textSize, helpUrl, onClose }: AccountMenuProps & { onClose: () => void }) {
  const t = useTranslations('clientDashboard.accountMenu')
  return (
    <div className="flex flex-col gap-1">
      {name || email ? (
        <div className="min-w-0 px-3 pb-2 pt-1">
          {name ? <p className="truncate text-[0.9375rem] font-semibold text-foreground">{name}</p> : null}
          {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
        </div>
      ) : null}
      <Link href="/account" onClick={onClose} className={ROW}>
        {t('account')}
      </Link>
      <div className="space-y-3 px-3 py-3">
        <AppThemeSwitch initial={theme} />
        <AppTextSizeSwitch initial={textSize} />
      </div>
      {helpUrl ? (
        <a href={helpUrl} target="_blank" rel="noopener noreferrer" onClick={onClose} className={ROW}>
          {t('help')}
          <span className="sr-only"> {t('opensInNewTab')}</span>
        </a>
      ) : null}
      <SignOutButton className={ROW} onSignOut={onClose} />
      <div className="border-t border-border-subtle px-3 pb-1 pt-3">
        <AppVersion />
      </div>
    </div>
  )
}

export function AccountMenu(props: AccountMenuProps) {
  const { variant, name, email, avatarUrl } = props
  const t = useTranslations('clientDashboard.accountMenu')
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const desktop = variant === 'sidebar'

  const dismiss = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }, [])
  const close = useCallback(() => dismiss(false), [dismiss])

  useAnchoredPopover({ open: open && desktop, anchorRef: buttonRef, panelRef, align: 'left', gap: 6, onDismiss: dismiss })

  // Like the sidebar drawer: focus moves into the popover when it opens.
  useEffect(() => {
    if (open && desktop) panelRef.current?.focus({ preventScroll: true })
  }, [open, desktop])

  const label = name || email

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={desktop ? undefined : t('open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          setTarget(portalTarget(e.currentTarget))
          setOpen((o) => !o)
        }}
        className={
          desktop
            ? 'flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
            : 'grid size-11 shrink-0 place-items-center rounded-full hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
        }
      >
        <Avatar name={name} email={email} src={avatarUrl} size="sm" />
        {desktop ? (
          <span className="min-w-0 flex-1 pt-0.5">
            <span className="block truncate text-sm font-medium text-foreground">{label}</span>
            {name && email ? <span className="block truncate text-xs text-muted-foreground">{email}</span> : null}
          </span>
        ) : null}
      </button>

      {desktop && open && target
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role="dialog"
              aria-label={t('title')}
              tabIndex={-1}
              style={FLOATING_STYLE}
              className="z-50 w-64 rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-raise)] outline-none"
            >
              <MenuBody {...props} onClose={close} />
            </div>,
            target,
          )
        : null}

      {!desktop ? (
        <BottomSheet open={open} title={t('title')} onClose={close}>
          {open ? <MenuBody {...props} onClose={close} /> : null}
        </BottomSheet>
      ) : null}
    </>
  )
}
