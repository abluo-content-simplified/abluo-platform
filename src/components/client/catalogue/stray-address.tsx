'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { languageName } from '@/components/client/create/StepHeading'
import { Notice } from '@/components/app/ui/Notice'
import { Button } from '@/components/app/ui/Button'

/**
 * ADR-033 E-3 — when a localized NAME is cleared while that language still has
 * an address, the editor is offered (inline, no confirm dialog) to clear the
 * address too, with Undo. Nothing is cleared behind the editor's back: if they
 * keep it, publishing refuses and names the language.
 */
type Stray = { locale: string; slug: string; cleared: boolean }

export function useStrayAddress(setSlug: (locale: string, value: string) => void) {
  const [stray, setStray] = useState<Stray | null>(null)
  return {
    stray,
    /** Call after a name edit: `slug` is that language's current address. */
    onNameChange: (locale: string, name: string, slug: string | undefined) => {
      if (!name.trim() && slug?.trim()) setStray({ locale, slug, cleared: false })
      else if (stray?.locale === locale && name.trim()) setStray(null)
    },
    clear: () => {
      if (!stray) return
      setSlug(stray.locale, '')
      setStray({ ...stray, cleared: true })
    },
    undo: () => {
      if (!stray) return
      setSlug(stray.locale, stray.slug)
      setStray({ ...stray, cleared: false })
    },
    dismiss: () => setStray(null),
  }
}

export function StrayAddressNotice({ state }: { state: ReturnType<typeof useStrayAddress> }) {
  const t = useTranslations('catalogue.dashboard.strayAddress')
  const tc = useTranslations('catalogue.dashboard.common')
  const ui = useLocale()
  const s = state.stray
  if (!s) return null
  const language = languageName(s.locale, ui)
  return (
    <Notice
      tone="dashed"
      layout="row"
      onDismiss={state.dismiss}
      dismissLabel={tc('dismiss')}
      action={
        <Button variant="secondary" onClick={s.cleared ? state.undo : state.clear}>
          {s.cleared ? t('undo') : t('clear')}
        </Button>
      }
    >
      {s.cleared ? t('cleared', { language }) : t('offer', { language, slug: s.slug })}
    </Notice>
  )
}

/** E-3 publish refusal: move focus to the first named language's name field (`data-name-locale`). */
export function focusNameField(locale: string) {
  if (typeof window === 'undefined') return
  window.requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-name-locale="${CSS.escape(locale)}"]`)
    el?.scrollIntoView?.({ block: 'center' })
    el?.focus()
  })
}
