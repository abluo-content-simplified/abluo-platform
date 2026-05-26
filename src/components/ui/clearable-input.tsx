"use client"

import * as React from "react"
import { X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface ClearableInputProps extends Omit<React.ComponentProps<typeof Input>, "onChange"> {
  value: string
  onChange: (value: string) => void
  /** Minimum characters before showing the clear button (default: 3) */
  clearThreshold?: number
}

/**
 * Input with a clear button that appears after a threshold of characters.
 * The clear button is positioned like the password visibility toggle.
 */
function ClearableInput({
  value,
  onChange,
  clearThreshold = 3,
  className,
  ...props
}: ClearableInputProps) {
  const showClear = value.length >= clearThreshold

  const handleClear = () => {
    onChange("")
  }

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(showClear && "pr-10", className)}
        {...props}
      />
      {showClear && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Clear input"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

export { ClearableInput }
