'use client'

import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading } from '@/components/client/create/StepHeading'

/** Where calls to action are prepared (Website Settings → Calls to action). */
const STUDIO_URL = 'https://admin.abluo.app/studio'

/**
 * "Add a call to action?" (ADR-025 · post CTA), on every blog. The project's
 * calls to action are callToAction documents (Website Settings); the client
 * picks the site default, another prepared one, or none. A site with none yet
 * gets a short explanation and the way to set them up; Next skips the step.
 */
export function CtaStep({ draft, site, update }: StepProps) {
  const t = useTranslations('clientDashboard.create.cta')
  const ctas = site.ctas ?? []
  const def = ctas.find((c) => c.isDefault) ?? null
  const others = ctas.filter((c) => c !== def)
  const mode = draft.cta?.mode ?? 'default'
  const selected = mode === 'none' ? 'none' : mode === 'custom' ? `custom:${draft.cta?.ref ?? ''}` : 'default'

  const pick = (value: string) => {
    if (value === 'none') update({ 'cta.mode': 'none', 'cta.ref': null })
    else if (value === 'default') update({ 'cta.mode': 'default', 'cta.ref': null })
    else update({ 'cta.mode': 'custom', 'cta.ref': value.slice('custom:'.length) })
  }

  if (ctas.length === 0) {
    return (
      <section aria-labelledby="cta-step-title">
        <StepHeading id="cta-step-title" title={t('title')} />
        <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-border p-4">
          <p className="text-[1.0625rem] leading-7 font-medium text-foreground">
            {site.firstName ? t('empty.hello', { firstName: site.firstName }) : t('empty.helloNoName')}
          </p>
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('empty.what')}</p>
          <a
            href={STUDIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('empty.setup')}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </a>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="cta-step-title">
      <StepHeading id="cta-step-title" title={t('title')} helper={t('helper')} />
      <div role="radiogroup" aria-label={t('options')} className="mt-8 flex flex-col gap-3">
        {def ? (
          <Option value="default" selected={selected} onPick={pick} title={t('useDefault')}>
            <CtaPreview heading={def.heading ?? def.name} button={def.buttonLabel} />
          </Option>
        ) : null}
        {others.length > 0 ? (
          <p className="mt-3 text-[0.9375rem] font-semibold text-foreground">{def ? t('chooseAnother') : t('options')}</p>
        ) : null}
        {others.map((c) => (
          <Option key={c.id} value={`custom:${c.id}`} selected={selected} onPick={pick} title={c.name}>
            <CtaPreview heading={c.heading} button={c.buttonLabel} />
          </Option>
        ))}
        <Option value="none" selected={selected} onPick={pick} title={t('none')}>
          <span className="text-[0.9375rem] leading-6 text-muted-foreground">{t('noneHelp')}</span>
        </Option>
      </div>
    </section>
  )
}

function Option({
  value,
  selected,
  onPick,
  title,
  children,
}: {
  value: string
  selected: string
  onPick: (v: string) => void
  title: string
  children: React.ReactNode
}) {
  const on = selected === value
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => onPick(value)}
      className={`flex min-h-16 w-full flex-col items-start gap-2 rounded-2xl border-2 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        on ? 'border-foreground bg-selected-tint' : 'border-border hover:bg-hover'
      }`}
    >
      <span className="text-[1.0625rem] font-semibold text-foreground">{title}</span>
      {children}
    </button>
  )
}

/** A small, neutral sketch of the CTA (the real one uses the site's design). */
function CtaPreview({ heading, button }: { heading: string | null; button: string | null }) {
  if (!heading && !button) return null
  return (
    <span className="flex w-full flex-col items-start gap-2 rounded-xl bg-muted px-4 py-3">
      {heading ? <span className="text-[0.9375rem] font-medium text-foreground">{heading}</span> : null}
      {button ? (
        <span className="inline-flex min-h-8 items-center rounded-full bg-background px-3 text-sm font-semibold text-foreground">
          {button}
        </span>
      ) : null}
    </span>
  )
}
