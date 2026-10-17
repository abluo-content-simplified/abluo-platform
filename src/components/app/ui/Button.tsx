import type { ComponentProps } from 'react'
import { Link } from '@/i18n/navigation'
import { buttonClass, iconButtonClass, type ButtonSize, type ButtonVariant } from './button-styles'
import { OVERLAY_CHIP } from './list/overlay-chip'

/**
 * The dashboard button (ADR-030 App layer). One component for every action:
 *
 *   <Button variant="primary" onClick={save}>Save</Button>
 *   <Button variant="secondary" size="lg" fullWidth>Cancel</Button>
 *   <ButtonLink variant="primary" href="/x/new">New</ButtonLink>
 *
 * Variants: primary (the one action colour per view), secondary (outlined),
 * quiet (no border), destructive (outlined, destructive text). Sizes: md = 44px,
 * lg = 48px. `type` defaults to "button" so a Button never submits a form by
 * accident — pass type="submit" explicitly.
 */
type Common = { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean }

export function Button({ variant, size, fullWidth, className, type = 'button', ...rest }: Common & ComponentProps<'button'>) {
  return <button type={type} className={buttonClass({ variant, size, fullWidth, className })} {...rest} />
}

/** A navigation link that looks like a Button (locale-aware Next Link). */
export function ButtonLink({ variant, size, fullWidth, className, ...rest }: Common & ComponentProps<typeof Link>) {
  return <Link className={buttonClass({ variant, size, fullWidth, className })} {...rest} />
}

/**
 * An icon-only action (move up/down, remove, dismiss, drag grip). `aria-label`
 * is required — the icon is not a name. Pass the icon as children. `pressed`
 * makes it a toggle (aria-pressed + the selected tint), e.g. Bold / H2 in a
 * text toolbar; short text like "H2" fits the 44px square. appearance "chip"
 * = the 2rem round chip on a photo or card media (star, drag, remove).
 */
export function IconButton({
  pressed,
  appearance = 'default',
  className,
  type = 'button',
  ...rest
}: ComponentProps<'button'> & { 'aria-label': string; pressed?: boolean; appearance?: 'default' | 'chip' }) {
  if (appearance === 'chip') {
    // The 2rem round chip that sits on a photo or card media (same as CardMenu's chip).
    return (
      <button
        type={type}
        aria-pressed={pressed}
        className={`${OVERLAY_CHIP} transition-colors duration-200 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 ${className ?? ''}`}
        {...rest}
      />
    )
  }
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={iconButtonClass(`${pressed ? 'bg-selected-tint' : ''} ${className ?? ''}`.trim())}
      {...rest}
    />
  )
}
