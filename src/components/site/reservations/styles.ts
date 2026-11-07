import type { CSSProperties } from 'react'

// Shared look of the private link pages — every value is a design-system token.
export const BODY: CSSProperties = { color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }
export const STRONG: CSSProperties = { color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }
export const MUTED: CSSProperties = { color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' }

export const CARD: CSSProperties = {
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  borderRadius: 'var(--form-border-radius, var(--radius-btn))',
}

export const BTN_BASE = 'inline-flex min-h-11 items-center justify-center px-5 text-sm font-semibold tracking-wide transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export const BTN_PRIMARY: CSSProperties = {
  backgroundColor: 'var(--btn-primary-bg, var(--color-primary))',
  color: 'var(--btn-primary-text, #fff)',
  borderRadius: 'var(--radius-btn)',
  outlineColor: 'var(--color-primary)',
  border: '1px solid transparent',
}

export const BTN_SECONDARY: CSSProperties = {
  backgroundColor: 'transparent',
  color: 'var(--color-text-primary)',
  borderRadius: 'var(--radius-btn)',
  outlineColor: 'var(--color-primary)',
  border: '1px solid var(--color-border)',
}

export const NOTICE_OK: CSSProperties = { ...CARD, color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }
export const NOTICE_ERROR: CSSProperties = {
  ...CARD,
  color: 'var(--form-error-color)',
  borderColor: 'var(--form-input-error-border)',
  fontFamily: 'var(--font-body)',
}
