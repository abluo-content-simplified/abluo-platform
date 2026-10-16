import type { TypeLevel } from '@/lib/modules/brand-hub/types'
import { CARD_STYLE, DoDontGrid, RichText, Section, Spec, ValueText, type HubPageProps } from './shared'

const DEFAULT_SIZE: Record<TypeLevel['key'], number> = { h1: 40, h2: 32, h3: 24, h4: 20, bodyLarge: 18, body: 16, small: 14 }

export function TypographyPage({ model, m, locale }: HubPageProps) {
  const w = model.written.typography
  return (
    <>
      <Section title={m.fontsTitle}>
        <ul className="grid gap-4 sm:grid-cols-3">
          {model.fonts.map((f) => (
            <li key={f.role} className="break-inside-avoid p-5" style={CARD_STYLE}>
              <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{m.fontRoles[f.role]}</h3>
              <dl className="flex flex-col gap-1.5">
                <Spec label={m.family} source={f.source} m={m}>
                  <span className="text-base font-semibold">{f.name ?? m.sources.notSet.label}</span>
                </Spec>
                {f.provider && (
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {f.provider === 'google' ? m.providerGoogle : m.providerLibrary}
                  </p>
                )}
              </dl>
            </li>
          ))}
        </ul>
      </Section>

      <RichText value={w.body} />

      <Section title={m.levelsTitle}>
        <ul className="flex flex-col gap-5">
          {model.typeLevels.map((lvl) => {
            const size = lvl.size.value ?? DEFAULT_SIZE[lvl.key]
            return (
              <li key={lvl.key} className="break-inside-avoid p-5" style={CARD_STYLE}>
                <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{m.levels[lvl.key]}</h3>
                <p
                  className="mb-4 break-words"
                  style={{
                    fontFamily: lvl.family === 'heading' ? 'var(--font-heading)' : 'var(--font-body)',
                    fontSize: `${size}px`,
                    fontWeight: lvl.weight.value ?? undefined,
                    lineHeight: lvl.lineHeight.value ?? undefined,
                    letterSpacing: lvl.letterSpacing.value === null ? undefined : `${lvl.letterSpacing.value}px`,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {m.specimenSample}
                </p>
                <dl className="grid gap-1.5 sm:grid-cols-2">
                  <Spec label={m.size} source={lvl.size.source} m={m}><ValueText v={lvl.size} unit="px" locale={locale} m={m} /></Spec>
                  {lvl.minSize.value !== null || lvl.minSize.source !== 'notSet' ? (
                    <Spec label={m.minSize} source={lvl.minSize.source} m={m}><ValueText v={lvl.minSize} unit="px" locale={locale} m={m} /></Spec>
                  ) : null}
                  <Spec label={m.weight} source={lvl.weight.source} m={m}><ValueText v={lvl.weight} locale={locale} m={m} /></Spec>
                  <Spec label={m.lineHeight} source={lvl.lineHeight.source} m={m}><ValueText v={lvl.lineHeight} locale={locale} m={m} /></Spec>
                  <Spec label={m.letterSpacing} source={lvl.letterSpacing.source} m={m}><ValueText v={lvl.letterSpacing} unit="px" locale={locale} m={m} /></Spec>
                  <Spec label={m.family} m={m}><span>{lvl.family === 'heading' ? m.fontRoles.heading : m.fontRoles.body}</span></Spec>
                </dl>
              </li>
            )
          })}
        </ul>
      </Section>
      <DoDontGrid items={w.doDont} m={m} />
    </>
  )
}
