import type { BrandHubMessages } from '@/lib/i18n/brand-hub-messages'
import { formatBrandHubMessage } from '@/lib/i18n/brand-hub-messages'
import type { ColourRole, ColourValue, ThemeKey } from '@/lib/modules/brand-hub/types'
import { CopyButton } from './CopyButton'
import { ContrastGrid } from './ContrastGrid'
import { BrandPalette } from './BrandPalette'
import { TokensPanel } from './TokensPanel'
import {
  CARD_STYLE, DoDontGrid, HATCHED, HEADING_FONT, MONO, RichText, Section, Spec, ValueLabel,
  paint, themeBackground, type HubPageProps,
} from './shared'

const THEMES: ThemeKey[] = ['light', 'dark']

function CopyRow({ label, value, m }: { label: string; value: string; m: BrandHubMessages }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <dt className="w-24 shrink-0 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</dt>
      <dd className="m-0 flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className={MONO}>{value}</span>
        <CopyButton
          value={value}
          copyText={m.copy}
          copiedText={m.copied}
          ariaLabel={formatBrandHubMessage(m.copyLabel, { value })}
        />
      </dd>
    </div>
  )
}

function ColourSide({ role, theme, value, m }: { role: ColourRole; theme: ThemeKey; value: ColourValue; m: BrandHubMessages }) {
  const painted = paint(value)
  const themeName = theme === 'light' ? m.light : m.dark
  return (
    <div className="min-w-0">
      <h4 className="mb-2 text-sm font-semibold">{themeName}</h4>
      <div
        role="img"
        aria-label={`${m.roles[role.key]} (${themeName})`}
        className="h-16 w-full"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          ...(painted ? { background: painted } : HATCHED),
        }}
      />
      <div className="mt-3 flex flex-col gap-2">
        <ValueLabel source={value.source} m={m} />
        {value.source !== 'notSet' && (
          <dl className="flex flex-col gap-1.5">
            {value.stored && <CopyRow label={m.storedValue} value={value.stored} m={m} />}
            {value.hex && <CopyRow label={m.hex} value={value.hex} m={m} />}
            {value.rgb && <CopyRow label={m.rgb} value={value.rgb} m={m} />}
          </dl>
        )}
        <ul className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {value.approximate && <li>{m.approximate}</li>}
          {value.alpha < 1 && value.compositedOn && (
            <li>{formatBrandHubMessage(m.opacityNote, { n: Math.round(value.alpha * 100), role: m.roles[value.compositedOn] })}</li>
          )}
          {value.sameAs && <li>{formatBrandHubMessage(m.sameAs, { role: m.roles[value.sameAs] })}</li>}
        </ul>
      </div>
    </div>
  )
}

function Buttons({ model, m, locale }: HubPageProps) {
  if (model.buttons.length === 0) return null
  return (
    <Section title={m.buttonsTitle}>
      <div className="flex flex-col gap-6">
        {model.buttons.map((b) => (
          <div key={b.variant} className="break-inside-avoid p-5" style={CARD_STYLE}>
            <h3 className="mb-4 text-lg font-semibold" style={HEADING_FONT}>
              {b.variant === 'primary' ? m.buttonPrimary : m.buttonSecondary}
            </h3>
            <div className="grid gap-5 sm:grid-cols-2">
              {THEMES.map((t) => {
                const spec = b[t]
                const radius = spec.borderRadius.value
                return (
                  <div key={t} className="min-w-0">
                    <h4 className="mb-2 text-sm font-semibold">{t === 'light' ? m.light : m.dark}</h4>
                    <div
                      className="flex items-start p-4"
                      style={{ background: themeBackground(model, t), border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}
                    >
                      <span
                        className="inline-block px-5 py-2.5 text-sm font-semibold"
                        style={{
                          background: paint(spec.background),
                          color: paint(spec.text),
                          borderRadius: radius === null ? 'var(--radius-btn)' : `${radius}px`,
                          border: '1px solid var(--color-border)',
                          fontFamily: 'var(--font-body)',
                        }}
                      >
                        {m.buttonSample}
                      </span>
                    </div>
                    <dl className="mt-3 flex flex-col gap-1.5">
                      <Spec label={m.buttonBackground} source={spec.background.source} m={m}>
                        <span className={MONO}>{spec.background.hex ?? spec.background.stored ?? m.sources.notSet.label}</span>
                      </Spec>
                      <Spec label={m.buttonText} source={spec.text.source} m={m}>
                        <span className={MONO}>{spec.text.hex ?? spec.text.stored ?? m.sources.notSet.label}</span>
                      </Spec>
                      <Spec label={m.buttonHover} source={spec.hoverBackground.source} m={m}>
                        <span className={MONO}>{spec.hoverBackground.hex ?? spec.hoverBackground.stored ?? m.sources.notSet.label}</span>
                      </Spec>
                      <Spec label={m.buttonRadius} source={spec.borderRadius.source} m={m}>
                        {radius === null ? (
                          <span>{m.sources.notSet.label}</span>
                        ) : radius >= 999 ? (
                          <span>{m.pill}</span>
                        ) : (
                          <span>{new Intl.NumberFormat(locale).format(radius)}px</span>
                        )}
                      </Spec>
                    </dl>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

export function ColourPage(props: HubPageProps) {
  const { model, m } = props
  const w = model.written.colour
  return (
    <>
      <RichText value={w.body} />
      <BrandPalette {...props} />
      <Section title={m.uiColoursTitle} id="interface-colours">
        <p className="mb-6 max-w-[var(--layout-max-text-width,720px)] text-[0.9375rem]" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
          {m.uiColoursIntro}
        </p>
        <ul className="grid gap-5">
          {model.colours.map((role) => (
            <li key={role.key} className="break-inside-avoid p-5" style={CARD_STYLE}>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold" style={HEADING_FONT}>{m.roles[role.key]}</h3>
                <span className={MONO} style={{ color: 'var(--color-text-secondary)' }}>{role.cssVar ? `var(${role.cssVar})` : m.noCssVariable}</span>
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                {THEMES.map((t) => (
                  <ColourSide key={t} role={role} theme={t} value={role[t]} m={m} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <Buttons {...props} />
      <ContrastGrid {...props} />
      <TokensPanel {...props} />
      <Section>
        <p className="max-w-[var(--layout-max-text-width,720px)] text-sm" style={{ color: 'var(--color-text-secondary)' }}>{m.printNote}</p>
      </Section>
      <DoDontGrid items={w.doDont} m={m} />
    </>
  )
}
