'use client'
// ── Members bar on every page (ADR-040 §15, R9) ───────────────────────────────
// Shown only while this browser is signed in to the site (asked once per page
// view from the status route — the access cookie is HttpOnly, so the page
// cannot read it). Signing out is a plain form post: it works without
// JavaScript on protected pages, and here the form is only shown once known.
// Text comes from the website Access dictionary (injected by the layout).

import { useEffect, useState } from 'react'

type Props = {
  statusUrl: string
  signOutAction: string
  returnField: string
  labels: { membersArea: string; signOut: string }
}

export function MembersStatusBar({ statusUrl, signOutAction, returnField, labels }: Props) {
  const [signedIn, setSignedIn] = useState(false)
  const [returnTo, setReturnTo] = useState('')
  useEffect(() => {
    let alive = true
    setReturnTo(window.location.pathname)
    fetch(statusUrl, { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((d: { signedIn?: unknown }) => { if (alive) setSignedIn(d?.signedIn === true) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [statusUrl])
  if (!signedIn) return null
  return <MembersStatusBarView signOutAction={signOutAction} returnField={returnField} returnTo={returnTo} labels={labels} />
}

/**
 * The bar itself (pure, server-renderable — tested in isolation). R9: on the
 * site's accent so a signed-in visitor cannot miss it. Background and text are
 * the design system's PRIMARY BUTTON pair (`--btn-primary-bg` /
 * `--btn-primary-text`, which default to the primary colour and the page
 * background): the same pair every primary button uses, so it is readable for
 * every tenant in light and dark mode, and follows a tenant's own button
 * colours when it has them. Falls back to `--color-primary` on the page
 * background outside a site layout. The sign-out stays underlined, and its
 * focus ring is drawn in the bar's own text colour so it shows on the accent.
 */
export function MembersStatusBarView({
  signOutAction,
  returnField,
  returnTo,
  labels,
}: Pick<Props, 'signOutAction' | 'returnField' | 'labels'> & { returnTo: string }) {
  return (
    <div
      className="w-full"
      data-access="members-status"
      style={{
        background: 'var(--btn-primary-bg, var(--color-primary))',
        color: 'var(--btn-primary-text, var(--color-background))',
        fontFamily: 'var(--font-body)',
      }}
    >
      <form
        method="post"
        action={signOutAction}
        className="mx-auto flex max-w-[var(--layout-max-content-width,1120px)] flex-wrap items-center justify-end gap-x-3 gap-y-1 px-6 py-2 text-sm font-medium md:px-10 lg:px-16"
      >
        <span>{labels.membersArea}</span>
        <span aria-hidden="true">·</span>
        <input type="hidden" name={returnField} value={returnTo} />
        <button
          type="submit"
          className="rounded-sm underline underline-offset-4 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ color: 'inherit', outlineColor: 'currentColor' }}
        >
          {labels.signOut}
        </button>
      </form>
    </div>
  )
}
