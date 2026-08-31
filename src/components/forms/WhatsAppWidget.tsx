'use client'

/**
 * WhatsAppWidget — ADR-018 (WhatsApp channel).
 *
 * One reusable WhatsApp entry point with two presentations:
 *   - variant "inline": a green "Chat on WhatsApp" button (used inside the
 *     contact section next to the message button)
 *   - variant "fab": a floating action button pinned bottom-right, mounted
 *     site-wide from the layout when enabled in settings
 *
 * Both open the SAME overlay: the subject cards + message box from a tenant
 * `formDefinition` (design-system-driven, like every other form). On send it
 * does two things in the click gesture: fires a best-effort save to the normal
 * submissions endpoint (so the lead lands in the dashboard with `source:
 * whatsapp` + attribution) using `keepalive` so it survives the navigation,
 * then opens WhatsApp pre-filled with the subject + message. WhatsApp can't send
 * on the visitor's behalf, so they tap send once in the app — that's expected.
 */

import { useMemo, useRef, useState } from 'react'
import { FormModal } from './FormModal'
import { FormField, validateForm } from '@/components/fields'
import type { RenderableFormDefinition } from '@/lib/sanity/types'
import {
  singleStepFields,
  buildFieldConfigs,
  buildSubmissionPayload,
  submissionEndpoint,
  projectScopeSlugFromUrlSegment,
} from '@/lib/forms/render-mapping'
import { collectClientSource } from '@/lib/forms/source'
import { getFormSectionMessages } from '@/lib/i18n/form-section-messages'
import { getOverlayChromeMessages } from '@/lib/forms/overlay'
import { buildWhatsAppLink } from '@/lib/forms/whatsapp'
import type { UrlProjectSegment } from '@/lib/tenancy/ids'

const WA_GREEN = '#25D366'

function WhatsAppGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm5.8 14.16c-.24.68-1.42 1.32-1.95 1.36-.5.05-1.13.07-1.83-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.8-4.17-4.94-4.36-.15-.19-1.19-1.58-1.19-3.02s.75-2.14 1.02-2.43c.27-.29.58-.36.78-.36.19 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.83 2.02.9 2.17.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.29.72 1.18 1.54 1.91 1.06.95 1.95 1.24 2.24 1.38.29.14.45.12.62-.07.17-.19.71-.83.9-1.11.19-.29.38-.24.64-.14.26.09 1.67.79 1.96.93.29.14.48.22.55.34.07.12.07.7-.17 1.38Z" />
    </svg>
  )
}

interface Props {
  /**
   * The form opened before hand-off (capture mode).
   *
   * `null` is direct mode (ADR-020 Amendment A): the button opens WhatsApp
   * straight away with no overlay and nothing recorded. Many practices want
   * exactly that, and forcing a form on them was the reason WhatsApp could not
   * be used without the Forms module.
   */
  definition: RenderableFormDefinition | null
  /** WhatsApp number (any format — normalised to digits for wa.me). */
  number: string
  /**
   * The `[tenant]` URL segment. Despite the name this is NOT a tenant slug:
   * No!Logo's segment is `nologo`, whose tenant is `freeriders`. See
   * `@/lib/tenancy/ids`.
   */
  tenantSlug: UrlProjectSegment
  locale?: string
  variant?: 'inline' | 'fab'
  /** Inline-button label override; defaults to the localized "Chat on WhatsApp". */
  label?: string
}

/** Shared trigger styling, so both modes present identically to a visitor. */
const fabClass =
  'fixed bottom-5 right-5 z-[400] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105'
const inlineClass =
  'inline-flex items-center gap-2 rounded-[var(--radius-btn)] px-5 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02]'

/**
 * Entry point. A thin dispatcher rather than a conditional inside one component:
 * the capture path is stateful and hook-heavy, the direct path is a plain link,
 * and React forbids calling hooks conditionally.
 */
export function WhatsAppWidget(props: Props) {
  if (!props.definition) return <WhatsAppDirectLink {...props} />
  return <WhatsAppCaptureWidget {...props} definition={props.definition} />
}

/** Direct mode — opens WhatsApp immediately, no overlay, nothing recorded. */
function WhatsAppDirectLink({ number, locale = 'en', variant = 'inline', label }: Props) {
  const m = getFormSectionMessages(locale)
  const triggerLabel = label ?? m.whatsappChat
  const href = buildWhatsAppLink(number)

  return variant === 'fab' ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={triggerLabel}
      className={fabClass}
      style={{ backgroundColor: WA_GREEN }}
    >
      <WhatsAppGlyph size={28} />
    </a>
  ) : (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={inlineClass}
      style={{ backgroundColor: WA_GREEN }}
    >
      <WhatsAppGlyph />
      {triggerLabel}
    </a>
  )
}

/** Capture mode — subject + message overlay, lead recorded, then hand-off. */
function WhatsAppCaptureWidget({ definition: def, number, tenantSlug, locale = 'en', variant = 'inline', label }: Props & { definition: RenderableFormDefinition }) {
  const m = getFormSectionMessages(locale)
  const chrome = getOverlayChromeMessages(locale)
  const fields = singleStepFields(def)
  const fieldConfigs = useMemo(() => (fields ? buildFieldConfigs(def, fields, false) : []), [def, fields])

  const openedAt = useRef(Date.now())
  const honeypotRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, unknown>>(
    () => Object.fromEntries(fieldConfigs.map((f) => [f.id, f.type === 'checkbox' ? false : ''])),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sent, setSent] = useState(false)

  if (!fields) return null

  const handleChange = (id: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [id]: value }))
    setErrors((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const close = () => {
    setOpen(false)
    // reset for the next open, once the exit animation has run
    setTimeout(() => { setSent(false); setValues(Object.fromEntries(fieldConfigs.map((f) => [f.id, f.type === 'checkbox' ? false : '']))); setErrors({}) }, 300)
  }

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    const validationErrors = validateForm(fieldConfigs, values, locale)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    // Compose the pre-filled WhatsApp text: subject label (if any) + message.
    const subjectCfg = fieldConfigs.find((c) => c.id === 'subject')
    const subjectVal = values['subject']
    const subjectLabel =
      subjectCfg && 'options' in subjectCfg
        ? (subjectCfg.options as { value: string; label: string }[]).find((o) => o.value === subjectVal)?.label ?? ''
        : ''
    const message = typeof values['message'] === 'string' ? (values['message'] as string) : ''
    const text = [subjectLabel, message].filter(Boolean).join('\n\n')

    // Best-effort save through the normal pipeline (spam + snapshot + storage +
    // attribution). keepalive lets it finish even though we navigate to WhatsApp.
    try {
      const payload = buildSubmissionPayload(values, {
        locale,
        openedAt: openedAt.current,
        honeypot: honeypotRef.current?.value ?? '',
        source: collectClientSource({ source: 'whatsapp' }),
      })
      // ⚠️ ONE-TO-N BOUNDARY — see projectScopeSlugFromUrlSegment.
      const endpoint = submissionEndpoint(
        projectScopeSlugFromUrlSegment(tenantSlug),
        def.formId,
      )
      void fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {})
    } catch {
      /* saving must never block the hand-off */
    }

    // Open WhatsApp within the user gesture (avoids popup blocking).
    window.open(buildWhatsAppLink(number, text), '_blank', 'noopener')
    setSent(true)
  }

  const triggerLabel = label ?? m.whatsappChat

  const trigger =
    variant === 'fab' ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={triggerLabel}
        className={fabClass}
        style={{ backgroundColor: WA_GREEN }}
      >
        <WhatsAppGlyph size={28} />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={inlineClass}
        style={{ backgroundColor: WA_GREEN }}
      >
        <WhatsAppGlyph />
        {triggerLabel}
      </button>
    )

  return (
    <>
      {trigger}
      <FormModal isOpen={open} onClose={close} closeLabel={chrome.closeLabel} title={def.title ?? m.whatsappTitle} eyebrow={null}>
        {sent ? (
          <div className="py-8 text-center">
            <p className="text-[var(--color-text-primary)] text-lg font-medium">{m.whatsappOpening}</p>
          </div>
        ) : (
          <form onSubmit={handleSend} noValidate className="space-y-0">
            <div className="grid grid-cols-12 gap-5">
              {fieldConfigs.map((config) => (
                <div key={config.id} className="col-span-12">
                  <FormField
                    config={config}
                    value={values[config.id]}
                    onChange={(val) => handleChange(config.id, val)}
                    error={errors[config.id]}
                  />
                </div>
              ))}
            </div>

            <input
              ref={honeypotRef}
              type="text"
              name="company_website"
              autoComplete="off"
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
            />

            <div className="sticky bottom-0 -mx-6 mt-6 px-6 pt-4 pb-1" style={{
              background: 'color-mix(in oklch, var(--color-background, var(--background)) 92%, transparent)',
              backdropFilter: 'blur(12px) saturate(1.4)',
              borderTop: '1px solid color-mix(in oklch, var(--color-border, var(--border)) 45%, transparent)',
            }}>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] px-6 py-3.5 text-sm font-semibold text-white transition-all"
                style={{ backgroundColor: WA_GREEN }}
              >
                <WhatsAppGlyph />
                {m.whatsappSend}
              </button>
            </div>
          </form>
        )}
      </FormModal>
    </>
  )
}
