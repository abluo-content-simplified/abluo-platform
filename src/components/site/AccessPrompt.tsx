'use client'

/**
 * ADR-040 B2.3 — the password prompt on a members-only page.
 *
 * A plain HTML form POST to the unlock route: it works without JavaScript,
 * and password managers see an ordinary `current-password` field. JavaScript
 * only adds comfort — the button shows that the password is being checked,
 * the field takes focus after a failed attempt, and the one-word outcome
 * (`?access=…`) is removed from the address bar so a reload or a shared link
 * does not repeat it.
 *
 * Styled with the site's design-system tokens (form + button tokens from the
 * [tenant] layout) and the platform's PasswordInput (reveal toggle). All text
 * arrives from getAccessMessages(); nothing about the page is passed in.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { PasswordInput } from '@/components/ui/PasswordInput'

export type AccessPromptProps = {
  action: string
  returnTo: string
  /** Form field names (ACCESS_FORM_FIELDS) — the route reads the same ones. */
  fields: { password: string; returnTo: string }
  labels: { password: string; show: string; hide: string; submit: string; submitting: string }
  notice: { tone: 'error' | 'info'; text: string; invalid?: boolean } | null
}

const NOTICE_PARAMS = ['access', 'wait']

export function AccessPrompt({ action, returnTo, fields, labels, notice }: AccessPromptProps) {
  const [pending, setPending] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const noticeId = useId()

  useEffect(() => {
    // Drop the outcome from the address bar; the message stays on screen.
    try {
      const url = new URL(window.location.href)
      if (NOTICE_PARAMS.some((p) => url.searchParams.has(p))) {
        NOTICE_PARAMS.forEach((p) => url.searchParams.delete(p))
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      }
    } catch {
      /* cosmetic only */
    }
    // Back/forward cache: a page restored after submitting must not stay "busy".
    const reset = () => setPending(false)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  useEffect(() => {
    if (notice?.tone === 'error') formRef.current?.querySelector<HTMLInputElement>(`input[name="${fields.password}"]`)?.focus()
  }, [notice, fields.password])

  const isError = notice?.tone === 'error'
  const isInvalid = notice?.invalid === true

  return (
    <form
      ref={formRef}
      method="post"
      action={action}
      onSubmit={() => setPending(true)}
      className="mx-auto mt-8 flex w-full max-w-[400px] flex-col gap-4 text-left"
      data-access="prompt"
    >
      {notice && (
        <p
          id={noticeId}
          role={isError ? 'alert' : 'status'}
          className="m-0 rounded-[var(--form-border-radius)] px-4 py-3 text-sm leading-relaxed text-pretty"
          style={{
            color: isError ? 'var(--form-error-color)' : 'var(--color-text-secondary)',
            border: `1px solid ${isError ? 'var(--form-input-error-border)' : 'var(--color-border)'}`,
            backgroundColor: 'var(--color-surface)',
            fontFamily: 'var(--font-body)',
          }}
        >
          {notice.text}
        </p>
      )}

      <input type="hidden" name={fields.returnTo} value={returnTo} />

      <PasswordInput
        name={fields.password}
        label={labels.password}
        showLabel={labels.show}
        hideLabel={labels.hide}
        required
        autoComplete="current-password"
        maxLength={256}
        spellCheck={false}
        autoCapitalize="none"
        aria-invalid={isInvalid || undefined}
        aria-describedby={notice ? noticeId : undefined}
        labelClassName="mb-1.5 block text-sm font-medium text-[color:var(--form-label-color)]"
        className="block w-full pr-20 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        toggleClassName="absolute inset-y-0 right-0 px-4 text-xs font-medium uppercase tracking-widest text-[color:var(--form-input-text)] opacity-70 hover:opacity-100"
        style={{
          height: 'var(--form-input-height)',
          padding: 'var(--form-padding-y) var(--form-padding-x)',
          paddingRight: '5rem',
          background: 'var(--form-input-bg)',
          border: `1px solid ${isInvalid ? 'var(--form-input-error-border)' : 'var(--form-input-border)'}`,
          borderRadius: 'var(--form-border-radius)',
          color: 'var(--form-input-text)',
          fontSize: '1rem', // 16px: no zoom-on-focus on iOS
          outlineColor: 'var(--form-input-focus-border)',
        }}
      />

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex h-12 w-full items-center justify-center px-8 text-sm font-semibold tracking-wide transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-progress disabled:opacity-70"
        style={{
          backgroundColor: 'var(--btn-primary-bg, var(--color-primary))',
          color: 'var(--btn-primary-text, #fff)',
          borderRadius: 'var(--radius-btn)',
          outlineColor: 'var(--color-primary)',
        }}
      >
        {pending ? labels.submitting : labels.submit}
      </button>
    </form>
  )
}
