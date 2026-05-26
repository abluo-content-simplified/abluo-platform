"use client"

import * as React from "react"
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import { cn } from "@/lib/utils"

interface DelayedTooltipProps {
  children: React.ReactNode
  content: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  className?: string
}

export function DelayedTooltip({
  children,
  content,
  side = "top",
  align = "center",
  className,
}: DelayedTooltipProps) {
  const [open, setOpen] = React.useState(false)
  const hoverTimerRef = React.useRef<NodeJS.Timeout | null>(null)
  const stillTimerRef = React.useRef<NodeJS.Timeout | null>(null)
  const lastMoveRef = React.useRef<number>(0)
  const isHoveringRef = React.useRef(false)

  const clearTimers = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    if (stillTimerRef.current) {
      clearTimeout(stillTimerRef.current)
      stillTimerRef.current = null
    }
  }

  const handleMouseEnter = () => {
    isHoveringRef.current = true
    lastMoveRef.current = Date.now()

    // Start the 700ms hover timer
    hoverTimerRef.current = setTimeout(() => {
      // Check if cursor has been still for 150ms
      checkStillness()
    }, 700)
  }

  const handleMouseMove = () => {
    lastMoveRef.current = Date.now()

    // Reset stillness timer
    if (stillTimerRef.current) {
      clearTimeout(stillTimerRef.current)
    }

    // If we're past the initial hover delay, start checking for stillness
    if (hoverTimerRef.current === null && isHoveringRef.current && !open) {
      checkStillness()
    }
  }

  const checkStillness = () => {
    if (!isHoveringRef.current) return

    stillTimerRef.current = setTimeout(() => {
      const timeSinceLastMove = Date.now() - lastMoveRef.current
      if (timeSinceLastMove >= 150 && isHoveringRef.current) {
        setOpen(true)
      }
    }, 150)
  }

  const handleMouseLeave = () => {
    isHoveringRef.current = false
    clearTimers()
    setOpen(false)
  }

  React.useEffect(() => {
    return () => clearTimers()
  }, [])

  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root open={open}>
        <BaseTooltip.Trigger
          onMouseEnter={handleMouseEnter}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          render={<span className="inline-flex" />}
        >
          {children}
        </BaseTooltip.Trigger>
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner side={side} alignment={align} sideOffset={4} className="z-[9999]">
            <BaseTooltip.Popup
              className={cn(
                "overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground",
                "animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
                className
              )}
            >
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  )
}
