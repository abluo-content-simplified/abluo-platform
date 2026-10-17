import type { BrandHubModel } from '@/lib/modules/brand-hub/types'
import { CopyButton } from './CopyButton'
import { CARD_STYLE, FOCUS_RING, MONO, Section, type HubPageProps } from './shared'

/**
 * CSS: only variables the website really emits (colour roles with a variable,
 * brand palette, the two font families). JSON: every value the hub shows.
 * Both are built from the model, i.e. from the design system — never typed in.
 */
export function buildTokensCss(model: BrandHubModel): string {
  const lines: string[] = ['/* Generated from the design system. Values change when the design system changes. */']
  const brand = model.brandPalette.filter((c) => c.value.stored)
  const heading = model.fonts.find((f) => f.role === 'heading')?.name
  const body = model.fonts.find((f) => f.role === 'body')?.name
  lines.push(':root {')
  for (const c of brand) lines.push(`  ${c.cssVar}: ${c.value.stored};`)
  if (heading) lines.push(`  --font-heading: '${heading}', sans-serif;`)
  if (body) lines.push(`  --font-body: '${body}', sans-serif;`)
  lines.push('}')
  for (const theme of ['light', 'dark'] as const) {
    lines.push(`[data-theme="${theme}"] {`)
    for (const r of model.colours) {
      const v = r[theme].stored
      if (r.cssVar && v) lines.push(`  ${r.cssVar}: ${v};`)
    }
    lines.push('}')
  }
  return lines.join('\n') + '\n'
}

export function buildTokensJson(model: BrandHubModel): string {
  const num = (v: { value: number | string | null }) => v.value
  const json = {
    brand: Object.fromEntries(model.brandPalette.map((c) => [c.key, { name: c.name, value: c.value.stored, hex: c.value.hex, cmyk: c.cmyk.value, pantone: c.pantone }])),
    colours: Object.fromEntries((['light', 'dark'] as const).map((t) => [t, Object.fromEntries(model.colours.filter((r) => r[t].stored).map((r) => [r.key, { value: r[t].stored, hex: r[t].hex }]))])),
    fonts: Object.fromEntries(model.fonts.filter((f) => f.name).map((f) => [f.role, f.name])),
    type: Object.fromEntries(model.typeLevels.map((l) => [l.key, { size: num(l.size), weight: num(l.weight), lineHeight: num(l.lineHeight), letterSpacing: num(l.letterSpacing) }])),
    spacing: Object.fromEntries(model.spacing.map((s) => [s.key, num(s.value)])),
    radius: Object.fromEntries(model.radius.map((s) => [s.key, num(s.value)])),
    motion: {
      ...Object.fromEntries(model.motion.durations.map((d) => [d.key, num(d.value)])),
      ...Object.fromEntries(model.motion.easings.map((e) => [e.key, num(e.value)])),
    },
  }
  return JSON.stringify(json, null, 2) + '\n'
}

const dataUri = (text: string, type: string) => `data:${type};charset=utf-8,${encodeURIComponent(text)}`

export function TokensPanel({ model, m }: HubPageProps) {
  const css = buildTokensCss(model)
  const json = buildTokensJson(model)
  const btn = `inline-block px-4 py-2 text-sm font-semibold ${FOCUS_RING}`
  const btnStyle = { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', borderRadius: 'var(--radius-btn)' }
  return (
    <Section title={m.tokensTitle} id="tokens">
      <p className="mb-5 max-w-[var(--layout-max-text-width,720px)] text-[0.9375rem]" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>{m.tokensIntro}</p>
      <div className="grid gap-5 lg:grid-cols-2">
        {[{ label: 'tokens.css', text: css, type: 'text/css', copy: m.copyCss, dl: m.downloadCss }, { label: 'tokens.json', text: json, type: 'application/json', copy: m.copyJson, dl: m.downloadJson }].map((f) => (
          <div key={f.label} className="min-w-0 p-5" style={CARD_STYLE}>
            <pre className={`${MONO} mb-4 max-h-64 overflow-auto whitespace-pre p-3`} style={{ background: 'var(--color-background-alt)', borderRadius: 'var(--radius-sm)' }}>{f.text}</pre>
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              <a href={dataUri(f.text, f.type)} download={f.label} className={btn} style={btnStyle}>{f.dl}</a>
              <CopyButton value={f.text} copyText={f.copy} copiedText={m.copied} ariaLabel={f.copy} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
