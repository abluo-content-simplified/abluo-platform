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
  return (
    <div className="w-full" data-access="members-status" style={{ background: 'var(--color-surface-2, transparent)', fontFamily: 'var(--font-body)' }}>
      <form
        method="post"
        action={signOutAction}
        className="mx-auto flex max-w-[var(--layout-max-content-width,1120px)] items-center justify-end gap-3 px-6 py-2 text-sm md:px-10 lg:px-16"
        style={{ color: 'var(--color-text-muted, var(--color-text-secondary))' }}
      >
        <span>{labels.membersArea}</span>
        <span aria-hidden="true">·</span>
        <input type="hidden" name={returnField} value={returnTo} />
        <button type="submit" className="underline underline-offset-4 hover:opacity-80" style={{ color: 'var(--color-text-secondary)' }}>
          {labels.signOut}
        </button>
      </form>
    </div>
  )
}
