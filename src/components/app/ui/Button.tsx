import type { ComponentProps } from 'react'
import { Link } from '@/i18n/navigation'
import { buttonClass, iconButtonClass, type ButtonSize, type ButtonVariant } from './button-styles'

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
 * is required — the icon is not a name. Pass the icon as children.
 */
export function IconButton({ className, type = 'button', ...rest }: ComponentProps<'button'> & { 'aria-label': string }) {
  return <button type={type} className={iconButtonClass(className)} {...rest} />
}
