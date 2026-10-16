import { CARD_STYLE, DoDontGrid, RichText, Section, Spec, ValueText, type HubPageProps } from './shared'

export function LayoutPage({ model, m, locale }: HubPageProps) {
  const w = model.written.layout
  const l = model.layout
  const keys = ['maxContentWidth', 'maxTextWidth', 'sectionPaddingY', 'sectionPaddingYCompact', 'sectionPaddingYLarge'] as const
  const content = l.maxContentWidth.value
  const text = l.maxTextWidth.value
  const textPct = content && text ? Math.min(100, (text / content) * 100) : null

  return (
    <>
      <RichText value={w.body} />
      <Section title={m.layoutTitle}>
        <dl className="flex flex-col gap-3 p-5" style={CARD_STYLE}>
          {keys.map((k) => (
            <Spec key={k} label={m.layoutLabels[k]} source={l[k].source} m={m}>
              <ValueText v={l[k]} unit="px" locale={locale} m={m} />
            </Spec>
          ))}
        </dl>
      </Section>

      {content && textPct !== null && (
        <Section title={m.layoutDiagramTitle}>
          <div className="p-5" style={CARD_STYLE}>
            <div aria-hidden="true" className="w-full p-2" style={{ border: '2px solid var(--color-text-secondary)', background: 'var(--color-background-alt)', borderRadius: 4 }}>
              <div className="h-8" style={{ width: `${textPct}%`, background: 'var(--color-text-secondary)', borderRadius: 2 }} />
            </div>
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              <li>{m.layoutLabels.maxContentWidth}: {content}px</li>
              <li>{m.layoutLabels.maxTextWidth}: {text}px</li>
            </ul>
          </div>
        </Section>
      )}
      <DoDontGrid items={w.doDont} m={m} />
    </>
  )
}
