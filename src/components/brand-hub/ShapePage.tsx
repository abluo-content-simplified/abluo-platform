import { CARD_STYLE, DoDontGrid, HEADING_FONT, RichText, Section, Spec, ValueText, type HubPageProps } from './shared'

export function ShapePage({ model, m, locale }: HubPageProps) {
  const w = model.written.shape
  const primary = model.buttons.find((b) => b.variant === 'primary')
  const pillRadius = primary ? [primary.light.borderRadius.value, primary.dark.borderRadius.value].find((r) => r !== null && r >= 999) : undefined
  const maxSpacing = Math.max(1, ...model.spacing.map((s) => s.value.value ?? 0))

  return (
    <>
      <RichText value={w.body} />

      <Section title={m.spacingTitle}>
        <ul className="flex flex-col gap-3 p-5" style={CARD_STYLE}>
          {model.spacing.map((s) => (
            <li key={s.key} className="break-inside-avoid">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="w-12 shrink-0 font-mono text-[0.8125rem]">{s.key}</span>
                <dl className="m-0"><Spec label="" source={s.value.source} m={m}><ValueText v={s.value} unit="px" locale={locale} m={m} /></Spec></dl>
              </div>
              {s.value.value !== null && (
                <div
                  aria-hidden="true"
                  className="h-3"
                  style={{
                    width: `min(100%, ${s.value.value}px)`,
                    maxWidth: `${(s.value.value / maxSpacing) * 100}%`,
                    minWidth: 2,
                    background: 'var(--color-text-secondary)',
                    borderRadius: 2,
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={m.radiusTitle}>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {model.radius.map((r) => (
            <li key={r.key} className="break-inside-avoid p-4" style={CARD_STYLE}>
              <div
                aria-hidden="true"
                className="mb-3 h-16 w-full"
                style={{
                  border: '2px solid var(--color-text-secondary)',
                  background: 'var(--color-background-alt)',
                  borderRadius: r.value.value === null ? 0 : `${r.value.value}px`,
                }}
              />
              <p className="font-mono text-[0.8125rem]">{r.key}</p>
              <dl className="mt-1"><Spec label="" source={r.value.source} m={m}><ValueText v={r.value} unit="px" locale={locale} m={m} /></Spec></dl>
            </li>
          ))}
        </ul>
      </Section>

      {pillRadius !== undefined && (
        <Section title={m.buttonRadiusTitle} id="button-radius">
          <div className="flex flex-wrap items-start gap-5 p-5" style={CARD_STYLE}>
            <span
              className="inline-block px-6 py-2.5 text-sm font-semibold"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', borderRadius: 9999, fontFamily: 'var(--font-body)' }}
            >
              {m.buttonSample}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{m.pill}</p>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{m.buttonRadiusNote}</p>
            </div>
          </div>
        </Section>
      )}

      <Section title={m.shadowsTitle}>
        {model.shadows.every((s) => s.value.source === 'notSet') ? (
          <p className="p-5 text-sm" style={{ ...CARD_STYLE, color: 'var(--color-text-secondary)' }}>{m.noShadows}</p>
        ) : (
        <ul className="grid gap-5 sm:grid-cols-3">
          {model.shadows.map((s) => (
            <li key={s.key} className="break-inside-avoid">
              <div
                className="h-24 p-4"
                style={{
                  background: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: s.value.value ?? 'none',
                }}
              >
                <h3 className="text-sm font-semibold" style={HEADING_FONT}>{m.shadows[s.key]}</h3>
              </div>
              <dl className="mt-3"><Spec label="" source={s.value.source} m={m}><ValueText v={s.value} locale={locale} m={m} /></Spec></dl>
            </li>
          ))}
        </ul>
        )}
      </Section>
      <DoDontGrid items={w.doDont} m={m} />
    </>
  )
}
