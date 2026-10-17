import type { BrandColour } from '@/lib/modules/brand-hub/types'
import { formatBrandHubMessage, type BrandHubMessages } from '@/lib/i18n/brand-hub-messages'
import { CopyButton } from './CopyButton'
import { CARD_STYLE, HATCHED, HEADING_FONT, MONO, Section, Spec, ValueLabel, paint, type HubPageProps } from './shared'

const TIERS: BrandColour['tier'][] = ['primary', 'secondary', 'neutral']

function Copyable({ value, m }: { value: string; m: BrandHubMessages }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={MONO}>{value}</span>
      <CopyButton value={value} copyText={m.copy} copiedText={m.copied} ariaLabel={formatBrandHubMessage(m.copyLabel, { value })} />
    </span>
  )
}

function BrandColourCard({ c, m }: { c: BrandColour; m: BrandHubMessages }) {
  const painted = paint(c.value)
  return (
    <li className="break-inside-avoid p-5" style={CARD_STYLE}>
      <div
        role="img"
        aria-label={c.name}
        className="mb-4 h-20 w-full"
        style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', ...(painted ? { background: painted } : HATCHED) }}
      />
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-lg font-semibold" style={HEADING_FONT}>{c.name}</h4>
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{m.usageLabels[c.usage]}</span>
      </div>
      {c.description && <p className="mb-2 text-[0.9375rem]" style={{ fontFamily: 'var(--font-body)' }}>{c.description}</p>}
      {c.uses && (
        <p className="mb-3 text-sm" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
          <span className="font-semibold">{m.usesLabel}: </span>{c.uses}
        </p>
      )}
      <dl className="flex flex-col gap-1.5">
        {c.value.stored && <Spec label={m.storedValue} source="designSystem" m={m}><Copyable value={c.value.stored} m={m} /></Spec>}
        {c.value.hex && <Spec label={m.hex} source="calculated" m={m}><Copyable value={c.value.hex} m={m} /></Spec>}
        {c.value.rgb && <Spec label={m.rgb} source="calculated" m={m}><Copyable value={c.value.rgb} m={m} /></Spec>}
        {c.cmyk.value && <Spec label={m.cmyk} source={c.cmyk.source} m={m}><span className={MONO}>{c.cmyk.value}</span></Spec>}
        {c.pantone && <Spec label={m.pantone} source="designSystem" m={m}><span className={MONO}>{c.pantone}</span></Spec>}
        <Spec label={m.cssVariable} m={m}><Copyable value={`var(${c.cssVar})`} m={m} /></Spec>
      </dl>
      {c.matchesRoles.length > 0 && (
        <p className="mt-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {formatBrandHubMessage(m.matchesRoles, { roles: c.matchesRoles.map((r) => m.roles[r]).join(', ') })}
        </p>
      )}
      {c.value.approximate && <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{m.approximate}</p>}
    </li>
  )
}

/** ADR-036 S2 — the brand's named colours, grouped by tier. Only what the design system holds. */
export function BrandPalette({ model, m }: HubPageProps) {
  return (
    <Section title={m.brandPaletteTitle} id="brand-colours">
      <p className="mb-6 max-w-[var(--layout-max-text-width,720px)] text-[0.9375rem]" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
        {m.brandPaletteIntro}
      </p>
      {model.brandPalette.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2 p-5" style={CARD_STYLE}>
          <ValueLabel source="notSet" m={m} />
          <span className="text-sm">{m.noPalette}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {TIERS.map((tier) => {
            const list = model.brandPalette.filter((c) => c.tier === tier)
            if (list.length === 0) return null
            return (
              <div key={tier}>
                <h3 className="mb-4 text-lg font-semibold" style={HEADING_FONT}>{m.tiers[tier]}</h3>
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((c) => <BrandColourCard key={c.key} c={c} m={m} />)}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
