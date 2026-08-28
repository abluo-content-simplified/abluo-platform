import { Children, cloneElement, type CSSProperties, type ReactElement, type SVGProps } from 'react'
import { ICONS, isIconName, type IconName } from '@/components/icons/registry'

export interface IconProps {
  /**
   * Registry key. Typed loosely on purpose: icon names arrive from Sanity as
   * plain strings, and an unrecognised one must render nothing rather than
   * break the page.
   */
  name: IconName | string
  /** Rendered width and height in px. Default 24. */
  size?: number
  className?: string
  style?: CSSProperties
  /**
   * Accessible label. Omit for decorative icons (the default) — the icon is
   * then hidden from assistive tech. Provide it only when the icon carries
   * meaning no adjacent text already conveys.
   */
  title?: string
}

/**
 * Platform icon primitive.
 *
 * Colour comes from the surrounding text colour (`currentColor`), so an icon
 * inherits whatever design-system token its container sets — e.g.
 * `style={{ color: 'var(--color-text-secondary)' }}`. Never give an icon a
 * hardcoded colour.
 *
 * Returns `null` for an unknown key — it never throws, so a stale or misspelt
 * value stored in Sanity degrades to "no icon" instead of a broken page.
 */
export function Icon({ name, size = 24, className, style, title }: IconProps) {
  // hasOwnProperty guard (via isIconName), so inherited Object.prototype keys
  // such as "toString" resolve to null rather than to a function.
  if (!isIconName(name)) return null
  const icon: ReactElement<SVGProps<SVGSVGElement>> = ICONS[name]

  const a11y: SVGProps<SVGSVGElement> = title
    ? { role: 'img', 'aria-label': title }
    : { 'aria-hidden': 'true', focusable: 'false' }

  return cloneElement(
    icon,
    {
      width: size,
      height: size,
      className,
      style,
      ...a11y,
    },
    ...(title
      ? [<title key="__icon-title">{title}</title>, ...Children.toArray(icon.props.children)]
      : [Children.toArray(icon.props.children)]),
  )
}
