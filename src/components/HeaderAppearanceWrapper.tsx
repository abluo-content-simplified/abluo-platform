'use client'

import { useState, useEffect } from 'react'
import type { HeaderAppearance } from '@/lib/sanity/types'

interface HeaderAppearanceWrapperProps {
  config?: HeaderAppearance
  children: React.ReactNode
}

/** Get CSS classes and styles based on appearance mode (initial or scrolled). */
function getHeaderStyles(
  mode: 'initial' | 'scrolled',
  config: HeaderAppearance | undefined
): { className: string; style: React.CSSProperties } {
  const style = mode === 'initial' ? config?.initialStyle : config?.scrolledStyle
  const opacity = (config?.backgroundOpacity ?? 85) / 100
  const blur = config?.blurEffect ?? true
  const shadow = config?.shadow ?? 'small'
  const height = config?.headerHeight ?? 'normal'
  const customHeight = config?.customHeight
  const zIndex = config?.zIndex ?? 50
  const borderStyle = config?.borderStyle ?? 'onScroll'
  const sticky = config?.stickyHeader ?? true

  // Height classes
  const heightClass = customHeight ? '' : {
    compact: 'h-12',
    normal: 'h-16',
    large: 'h-20',
  }[height]

  // Shadow classes
  const shadowClass = {
    none: '',
    small: 'shadow-sm',
    medium: 'shadow-md',
  }[shadow]

  // Style-specific classes and styles
  let bgColor = 'transparent'
  let backdropClass = ''

  if (style === 'solid') {
    bgColor = `color-mix(in oklch, var(--color-background) ${opacity * 100}%, transparent)`
  } else if (style === 'glass') {
    bgColor = `color-mix(in oklch, var(--color-background) ${opacity * 100}%, transparent)`
    backdropClass = blur ? 'backdrop-blur-sm' : ''
  }
  // transparent: bgColor stays transparent

  // Determine border visibility
  let borderBottom = 'none'
  if (borderStyle === 'always') {
    borderBottom = '1px solid var(--color-border)'
  } else if (borderStyle === 'onScroll') {
    borderBottom = mode === 'scrolled' ? '1px solid var(--color-border)' : 'none'
  }

  const positionClass = sticky ? 'fixed' : 'absolute'
  const className = `${positionClass} left-0 right-0 top-0 flex items-center justify-between px-6 md:px-16 lg:px-24 ${heightClass} ${shadowClass} ${backdropClass}`.trim()

  return {
    className,
    style: {
      backgroundColor: bgColor,
      borderBottom,
      transition: 'all 300ms ease-in-out',
      zIndex,
      height: customHeight ? `${customHeight}px` : undefined,
    },
  }
}

export function HeaderAppearanceWrapper({ config, children }: HeaderAppearanceWrapperProps) {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    if (!config?.stickyHeader) return

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [config?.stickyHeader])

  const mode = isScrolled ? 'scrolled' : 'initial'
  const { className, style } = getHeaderStyles(mode, config)

  return (
    <header className={className} style={style}>
      {children}
    </header>
  )
}
