'use client'

import type { ComponentProps } from 'react'
import { AppIcon } from '@/components/app/shell/AppIcon'

/**
 * A button in the phone bottom tab bar (client dashboard): either a tab (icon
 * over a short label, `active` = foreground colour; same look as the tab
 * links beside it) or the round "add" action that rises above the bar
 * (`appearance="add"`, needs `aria-label`). Extra native attributes pass
 * through (aria-expanded, aria-controls …).
 *
 *   <TabBarButton icon={MORE} active={moreActive} onClick={…} aria-expanded={open}>More</TabBarButton>
 *   <TabBarButton appearance="add" icon={PLUS} aria-label="Add" onClick={…} />
 */
export function TabBarButton({
  icon,
  active = false,
  appearance = 'tab',
  iconWidth,
  children,
  type = 'button',
  ...rest
}: Omit<ComponentProps<'button'>, 'className'> & { icon: string; active?: boolean; appearance?: 'tab' | 'add'; iconWidth?: number }) {
  if (appearance === 'add') {
    return (
      <button
        type={type}
        className="mx-auto grid size-[52px] -translate-y-3.5 place-items-center rounded-full bg-action text-action-foreground shadow-[var(--shadow-raise)]"
        {...rest}
      >
        <AppIcon d={icon} width={iconWidth ?? 2.2} />
      </button>
    )
  }
  return (
    <button
      type={type}
      className={`flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}
      {...rest}
    >
      <AppIcon d={icon} width={iconWidth} />
      {children}
    </button>
  )
}
