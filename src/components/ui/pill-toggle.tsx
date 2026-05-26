"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { DelayedTooltip } from "@/components/ui/delayed-tooltip"

export interface PillToggleOption<T extends string> {
  value: T
  icon: React.ReactNode
  tooltip: string
}

export interface PillToggleProps<T extends string> {
  label: string
  value: T
  onChange: (value: T) => void
  options: PillToggleOption<T>[]
  className?: string
}

export function PillToggle<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: PillToggleProps<T>) {
  return (
    <div className={cn("flex items-center justify-between px-2 py-1.5", className)}>
      <span className="text-sm text-sidebar-foreground/70">{label}</span>
      <div className="flex items-center gap-0.5 rounded-full bg-sidebar-accent/50 p-0.5">
        {options.map((option) => (
          <DelayedTooltip key={option.value} content={option.tooltip} side="top">
            <button
              onClick={() => onChange(option.value)}
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-colors",
                value === option.value
                  ? "bg-sidebar text-sidebar-foreground shadow-sm"
                  : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
              )}
            >
              {option.icon}
            </button>
          </DelayedTooltip>
        ))}
      </div>
    </div>
  )
}
