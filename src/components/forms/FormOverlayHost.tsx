'use client'

/**
 * FormOverlayHost — ADR-018 slice 7a.
 *
 * The single mount point that turns overlay state into a rendered form. It
 * reads the active request from FormOverlayContext, looks up the pre-resolved
 * definition (overlay.ts), and renders it inside FormModal using the SAME
 * single-vs-multi routing as the inline FormSection — so a definition behaves
 * identically whether placed on a page or opened as an overlay.
 *
 * Rendered once by FormOverlayWrapper. Returns null when no provider is present
 * or no form is open, so it is inert on pages/tenants without overlays.
 *
 * A closed request is retained briefly in local state so the panel's exit
 * animation plays with its content intact (mirrors EarlyAccessModal's deferred
 * clear) — the context stays the source of truth for open/closed.
 */

import { useEffect, useState } from 'react'
import { FormDefinitionRenderer } from './FormDefinitionRenderer'
import { MultiStepFormRenderer } from './MultiStepFormRenderer'
import { FormModal } from './FormModal'
import { useFormOverlaySafe } from './FormOverlayContext'
import { getFormSectionMessages } from '@/lib/i18n/form-section-messages'
import { selectOverlayForm, isMultiStepDefinition, getOverlayChromeMessages, type OverlayOpenRequest } from '@/lib/forms/overlay'

export function FormOverlayHost() {
  const ctx = useFormOverlaySafe()

  // Retain the last request through the close animation.
  const [display, setDisplay] = useState<OverlayOpenRequest | null>(null)
  const activeRequest = ctx?.request ?? null

  useEffect(() => {
    if (activeRequest) {
      setDisplay(activeRequest)
      return
    }
    const t = setTimeout(() => setDisplay(null), 300)
    return () => clearTimeout(t)
  }, [activeRequest])

  if (!ctx) return null

  const isOpen = activeRequest !== null
  const req = display
  const entry = req ? selectOverlayForm(ctx.forms, req.formId) : null

  const messages = getFormSectionMessages(ctx.locale)
  const chrome = getOverlayChromeMessages(ctx.locale)
  const def = entry?.definition
  const title = req?.title ?? def?.title ?? null

  return (
    <FormModal isOpen={isOpen} onClose={ctx.close} closeLabel={chrome.closeLabel} title={title}>
      {def ? (
        isMultiStepDefinition(def) ? (
          <MultiStepFormRenderer
            definition={def}
            messages={messages}
            locale={ctx.locale}
            tenantSlug={ctx.tenantSlug}
            context={req?.context ?? undefined}
          />
        ) : (
          <FormDefinitionRenderer
            definition={def}
            messages={messages}
            locale={ctx.locale}
            tenantSlug={ctx.tenantSlug}
          />
        )
      ) : null}
    </FormModal>
  )
}
