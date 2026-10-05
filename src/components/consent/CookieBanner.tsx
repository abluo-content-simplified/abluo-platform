'use client'

// ─── Cookie consent — banner + settings panel (ADR-021) ──────────────────────
//
// Styled ONLY from design-system CSS variables emitted by buildCssVars(), so it
// takes each site's colours, fonts, radii and light/dark theme automatically.
//
// Garante / EDPB rules this component enforces:
//   - "Accept all" and "Reject all" have identical visual weight (same token set);
//   - the X closes AS A REJECTION;
//   - nothing is pre-ticked; necessary is shown on and locked;
//   - non-blocking: no overlay, the page stays usable (no cookie wall).

import { useId, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ConsentGrants, ConsentPolicy, ConsentPurpose } from '@/lib/consent'
import { CONSENT_PURPOSES, acceptAll, rejectAll } from '@/lib/consent'
import { getConsentMessages } from '@/lib/i18n/consent-messages'
import type { MotionTokens } from '@/lib/sanity/types'

interface CookieBannerProps {
  open: null | 'first' | 'settings'
  onOpenSettings: () => void
  onChoose: (choice: Partial<Record<ConsentPurpose, boolean>>, vendorChoices?: Record<string, boolean>) => void
  policy: ConsentPolicy
  grants: ConsentGrants
  /** Embed vendors the visitor currently allows — withdrawable in settings. */
  vendors: { id: string; name: string }[]
  locale: string
  policyHref?: string
  motionTokens?: MotionTokens
}

/** "Vimeo · Google Maps" — the vendors in use for one purpose. */
function vendorList(policy: ConsentPolicy, p: ConsentPurpose): string {
  return (policy.purposes[p]?.vendors ?? []).map((v) => v.name).join(' · ')
}

const buttonStyle: React.CSSProperties = {
  background: 'var(--btn-secondary-bg, var(--color-surface))',
  color: 'var(--btn-secondary-text, var(--color-text-primary))',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-btn, var(--radius-md))',
  fontFamily: 'var(--font-body)',
}

function ActionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 flex-1 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={buttonStyle}
    >
      {children}
    </button>
  )
}

export function CookieBanner({
  open,
  onOpenSettings,
  onChoose,
  policy,
  grants,
  vendors,
  locale,
  policyHref,
  motionTokens,
}: CookieBannerProps) {
  const m = getConsentMessages(locale)
  const titleId = useId()
  const inUse = CONSENT_PURPOSES.filter((p) => policy.purposes[p])

  const duration = motionTokens?.durationBase !== undefined ? motionTokens.durationBase / 1000 : 0.25
  const ease: string | number[] = motionTokens?.easingDecelerate ?? [0, 0, 0.2, 1]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="cookie-banner"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration, ease: ease as never }}
          className="fixed inset-x-0 bottom-0 z-[450] p-3 md:inset-x-auto md:bottom-6 md:left-6 md:p-0"
        >
          <div
            className="relative w-full p-5 shadow-lg md:w-[440px] md:p-6"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              fontFamily: 'var(--font-body)',
            }}
          >
            <button
              type="button"
              onClick={() => onChoose(rejectAll())}
              aria-label={m.close}
              title={m.close}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center text-lg leading-none transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-sm)' }}
            >
              <span aria-hidden="true">×</span>
            </button>

            <h2
              id={titleId}
              className="pr-8 text-base font-semibold"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              {open === 'settings' ? m.settingsTitle : m.title}
            </h2>

            {open === 'first' ? (
              <>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {m.body}{' '}
                  {policyHref && (
                    <a href={policyHref} className="underline underline-offset-2" style={{ color: 'var(--color-text-primary)' }}>
                      {m.policyLink}
                    </a>
                  )}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {inUse.map((p) => (
                    <li key={p}>
                      {m.purposes[p].label}: {vendorList(policy, p)}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex gap-2">
                  <ActionButton onClick={() => onChoose(rejectAll())}>{m.rejectAll}</ActionButton>
                  <ActionButton onClick={() => onChoose(acceptAll(policy))}>{m.acceptAll}</ActionButton>
                </div>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="mt-3 text-sm underline underline-offset-2"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {m.customize}
                </button>
              </>
            ) : (
              <SettingsBody
                key="settings"
                policy={policy}
                grants={grants}
                vendors={vendors}
                inUse={inUse}
                locale={locale}
                policyHref={policyHref}
                onChoose={onChoose}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Mounted fresh each time settings open, so the toggles start from the saved state.
function SettingsBody({
  policy,
  grants,
  vendors,
  inUse,
  locale,
  policyHref,
  onChoose,
}: {
  policy: ConsentPolicy
  grants: ConsentGrants
  vendors: { id: string; name: string }[]
  inUse: ConsentPurpose[]
  locale: string
  policyHref?: string
  onChoose: (choice: Partial<Record<ConsentPurpose, boolean>>, vendorChoices?: Record<string, boolean>) => void
}) {
  const m = getConsentMessages(locale)
  const [draft, setDraft] = useState<Partial<Record<ConsentPurpose, boolean>>>(() =>
    Object.fromEntries(inUse.map((p) => [p, grants[p]]))
  )
  const [vendorDraft, setVendorDraft] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(vendors.map((v) => [v.id, true]))
  )
  const noVendors = Object.fromEntries(vendors.map((v) => [v.id, false]))
  return (
    <>
      <ul className="mt-3 space-y-3">
        <li className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{m.necessaryLabel}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{m.necessaryDescription}</p>
          </div>
          <span className="shrink-0 text-xs" style={{ color: 'var(--color-text-muted)' }}>{m.alwaysOn}</span>
        </li>
        {inUse.map((p) => {
          const on = draft[p] === true
          return (
            <li key={p} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{m.purposes[p].label}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{m.purposes[p].description}</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{vendorList(policy, p)}</p>
              </div>
              <Switch on={on} label={m.purposes[p].label} onToggle={() => setDraft((d) => ({ ...d, [p]: !on }))} />
            </li>
          )
        })}
      </ul>
      {vendors.length > 0 && (
        <>
          <p className="mt-4 text-sm font-medium">{m.embedsTitle}</p>
          <ul className="mt-2 space-y-3">
            {vendors.map((v) => {
              const on = vendorDraft[v.id] === true
              return (
                <li key={v.id} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{v.name}</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{m.embedNotice(v.name)}</p>
                  </div>
                  <Switch on={on} label={v.name} onToggle={() => setVendorDraft((d) => ({ ...d, [v.id]: !on }))} />
                </li>
              )
            })}
          </ul>
        </>
      )}
      {policyHref && (
        <a href={policyHref} className="mt-3 inline-block text-sm underline underline-offset-2" style={{ color: 'var(--color-text-secondary)' }}>
          {m.policyLink}
        </a>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton onClick={() => onChoose(rejectAll(), noVendors)}>{m.rejectAll}</ActionButton>
        <ActionButton onClick={() => onChoose(draft, vendorDraft)}>{m.save}</ActionButton>
        <ActionButton onClick={() => onChoose(acceptAll(policy), vendorDraft)}>{m.acceptAll}</ActionButton>
      </div>
    </>
  )
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className="relative mt-0.5 h-6 w-10 shrink-0 transition-colors"
      style={{
        background: on ? 'var(--color-primary)' : 'var(--color-border)',
        borderRadius: 'var(--radius-full, 9999px)',
      }}
    >
      <span
        className="absolute top-0.5 h-5 w-5 transition-all"
        style={{
          left: on ? '18px' : '2px',
          background: 'var(--color-background)',
          borderRadius: 'var(--radius-full, 9999px)',
        }}
      />
    </button>
  )
}
