'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppVersion } from './AppVersion'
import { SignOutButton } from './SignOutButton'
import { Avatar } from '../ui/Avatar'
import { AppTextSizeSwitch } from './AppTextSizeSwitch'
import { AppThemeSwitch } from './AppThemeSwitch'
import { BottomSheet } from '../ui/BottomSheet'
import { SidePanel } from '../ui/SidePanel'
import { FLOATING_STYLE, portalTarget, useAnchoredPopover } from '../ui/anchored-popover'
import type { AppTextSize, AppTheme } from '@/lib/app-theme'

/**
 * The signed-in person's own menu (ADR-029 §1, "user-level preferences ≠
 * project configuration"), shared by every Abluo App surface (ADR-030 — the
 * client dashboard and the admin): Profile · Preferences · Help · Sign out (icons on
 * every row; Tom 2026-10-08 — Preferences opens a side panel with appearance and
 * text size),
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
 * `md:hidden`). The sheet keeps its content only while open and while sliding
 * out (BottomSheet → useExitContent), so the two copies never sit in the page
 * together for long.
 *
 * Help is configuration (`ABLUO_HELP_URL`, read on the server): no URL, no row.
 * Profile is the caller's too (`profileHref`): a surface without a profile page
 * passes null and the row is not shown.
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
  /** Locale-agnostic href of the person's profile page; null hides the row. */
  profileHref: string | null
  /**
   * When set, Profile opens in place (the surface's own side panel — a sheet on
   * phones) instead of navigating to `profileHref` (Tom, 2026-10-08).
   */
  onProfile?: () => void
  /**
   * The person's role, shown under their name: a site role (ProjectGrant.role)
   * or a platform role (`abluo_admin`). Labels come from `app.roles`; an unknown
   * role is shown as is.
   */
  role?: string | null
  /** The site's display name, shown with the role ("Owner · Hoffmann"). None for a platform role. */
  siteName?: string | null
  /**
   * Extra rows a surface adds after Profile (e.g. the client's "What's new").
   * `variants` limits a row to one trigger (a surface that shows the same entry
   * elsewhere on desktop passes `['bar']`). A row with a `badge` > 0 shows a
   * count, and the phone avatar button a dot.
   */
  extraRows?: AccountMenuRow[]
}

export type AccountMenuRow = {
  key: string
  /** Already translated. */
  label: string
  /** An AppIcon-style path. */
  icon: string
  badge?: number
  /** Screen-reader text for the badge, already translated ("2 new updates"). */
  badgeLabel?: string
  onSelect: () => void
  variants?: readonly AccountMenuProps['variant'][]
}

function rowsFor(rows: AccountMenuRow[] | undefined, variant: AccountMenuProps['variant']): AccountMenuRow[] {
  return (rows ?? []).filter((r) => !r.variants || r.variants.includes(variant))
}

/** "Owner · Hoffmann" — the role (on the current site), localized; null when unknown. */
function useRoleLine(role?: string | null, siteName?: string | null): string | null {
  const t = useTranslations('app.roles')
  if (!role) return null
  const label = t.has(role) ? t(role) : role
  return siteName ? `${label} · ${siteName}` : label
}

const ROW_ICONS = {
  profile: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  preferences: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
  signOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
} as const

function RowIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground">
      <path d={d} />
    </svg>
  )
}

const ROW =
  'flex min-h-12 w-full items-start gap-3 rounded-md px-3 py-3 text-left text-[0.9375rem] text-foreground transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none md:min-h-10 md:py-2.5'

function MenuBody({ variant, name, email, helpUrl, profileHref, onProfile, role, siteName, extraRows, onClose, onPreferences }: AccountMenuProps & { onClose: () => void; onPreferences: () => void }) {
  const t = useTranslations('app.accountMenu')
  const roleLine = useRoleLine(role, siteName)
  return (
    <div className="flex flex-col gap-1">
      {name || email ? (
        <div className="min-w-0 px-3 pb-2 pt-1">
          {name ? <p className="truncate text-[0.9375rem] font-semibold text-foreground">{name}</p> : null}
          {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
          {roleLine ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{roleLine}</p> : null}
        </div>
      ) : null}
      {onProfile ? (
        <button
          type="button"
          onClick={() => {
            onClose()
            onProfile()
          }}
          className={ROW}
        >
          <RowIcon d={ROW_ICONS.profile} />
          {t('profile')}
        </button>
      ) : profileHref ? (
        <Link href={profileHref} onClick={onClose} className={ROW}>
          <RowIcon d={ROW_ICONS.profile} />
          {t('profile')}
        </Link>
      ) : null}
      {rowsFor(extraRows, variant).map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={() => {
            onClose()
            row.onSelect()
          }}
          className={ROW}
        >
          <RowIcon d={row.icon} />
          <span className="flex-1">{row.label}</span>
          {row.badge ? (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-action px-1.5 text-xs font-semibold text-action-foreground">
              <span aria-hidden="true">{row.badge}</span>
              {row.badgeLabel ? <span className="sr-only">{row.badgeLabel}</span> : null}
            </span>
          ) : null}
        </button>
      ))}
      <button type="button" onClick={onPreferences} className={ROW}>
        <RowIcon d={ROW_ICONS.preferences} />
        {t('preferences')}
      </button>
      {helpUrl ? (
        <a href={helpUrl} target="_blank" rel="noopener noreferrer" onClick={onClose} className={ROW}>
          <RowIcon d={ROW_ICONS.help} />
          {t('help')}
          <span className="sr-only"> {t('opensInNewTab')}</span>
        </a>
      ) : null}
      <SignOutButton className={ROW} onSignOut={onClose} icon={<RowIcon d={ROW_ICONS.signOut} />} />
      <div className="border-t border-border-subtle px-3 pb-1 pt-3">
        <AppVersion />
      </div>
    </div>
  )
}

export function AccountMenu(props: AccountMenuProps) {
  const { variant, name, email, avatarUrl, role, siteName } = props
  const t = useTranslations('app.accountMenu')
  const roleLine = useRoleLine(role, siteName)
  const [open, setOpen] = useState(false)
  // Preferences (appearance, text size) open in a side panel — a bottom sheet on phones (Tom, 2026-10-08).
  const [prefsOpen, setPrefsOpen] = useState(false)
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
  const openPreferences = useCallback(() => {
    setOpen(false)
    setPrefsOpen(true)
  }, [])

  useAnchoredPopover({ open: open && desktop, anchorRef: buttonRef, panelRef, align: 'left', gap: 6, onDismiss: dismiss })

  // Like the sidebar drawer: focus moves into the popover when it opens.
  useEffect(() => {
    if (open && desktop) panelRef.current?.focus({ preventScroll: true })
  }, [open, desktop])

  const label = name || email
  // A dot on the phone avatar when a row has something new.
  const flagged = desktop ? [] : rowsFor(props.extraRows, variant).filter((r) => r.badge)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={desktop ? undefined : [t('open'), ...flagged.map((r) => r.badgeLabel).filter(Boolean)].join(', ')}
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
        <span className="relative inline-flex shrink-0">
          <Avatar name={name} email={email} src={avatarUrl} size="sm" />
          {flagged.length ? (
            <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-action ring-2 ring-background" />
          ) : null}
        </span>
        {desktop ? (
          <span className="min-w-0 flex-1 pt-0.5">
            <span className="block truncate text-sm font-medium text-foreground">{label}</span>
            {roleLine ? <span className="block truncate text-xs text-muted-foreground">{roleLine}</span> : null}
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
              <MenuBody {...props} onClose={close} onPreferences={openPreferences} />
            </div>,
            target,
          )
        : null}

      <SidePanel open={prefsOpen} title={t('preferences')} closeLabel={t('close')} onClose={() => setPrefsOpen(false)}>
        <div className="space-y-5 py-1">
          <AppThemeSwitch initial={props.theme} />
          <AppTextSizeSwitch initial={props.textSize} />
        </div>
      </SidePanel>

      {!desktop ? (
        <BottomSheet open={open} title={t('title')} onClose={close}>
          <MenuBody {...props} onClose={close} onPreferences={openPreferences} />
        </BottomSheet>
      ) : null}
    </>
  )
}
