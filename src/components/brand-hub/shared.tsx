import type { CSSProperties, ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { PortableText } from '@portabletext/react'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'
import type { BrandHubMessages } from '@/lib/i18n/brand-hub-messages'
import type {
  BrandHubModel, ColourRoleKey, ColourValue, DesignValue, DoDontItem, ThemeKey, ValueSource,
} from '@/lib/modules/brand-hub/types'
import type { PortableTextContent } from '@/lib/sanity/types'

export interface HubPageProps {
  model: BrandHubModel
  m: BrandHubMessages
  locale: string
}

export const HEADING_FONT: CSSProperties = { fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }
export const MONO = 'font-mono text-[0.8125rem] break-all'

export const CARD_STYLE: CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
}

export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]'

/** Neutral structural checkerboard for transparent previews (not a brand colour). */
export const CHECKERBOARD: CSSProperties = {
  backgroundColor: '#ffffff',
  backgroundImage:
    'linear-gradient(45deg, #d4d4d4 25%, transparent 25%, transparent 75%, #d4d4d4 75%), linear-gradient(45deg, #d4d4d4 25%, transparent 25%, transparent 75%, #d4d4d4 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
}

export const HATCHED: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, transparent 0 6px, var(--color-border) 6px 7px)',
}

export function colourOf(model: BrandHubModel, role: ColourRoleKey, theme: ThemeKey): ColourValue | null {
  const r = model.colours.find((c) => c.key === role)
  return r ? r[theme] : null
}

/** Paint value for a colour from the model (never from CSS variables). */
export function paint(c: ColourValue | null | undefined): string | undefined {
  return c?.swatch ?? c?.hex ?? undefined
}

export function themeBackground(model: BrandHubModel, theme: ThemeKey): string | undefined {
  return paint(colourOf(model, 'background', theme))
}

export function formatNumber(locale: string, n: number): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n)
  } catch {
    return String(n)
  }
}

export function formatBytes(locale: string, bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  try {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`
  } catch {
    return `${Math.round(v)} ${units[i]}`
  }
}

export function formatDate(iso: string, locale: string, timeZone: string | null): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: timeZone ?? 'UTC' }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
  }
}

export function ValueLabel({ source, m }: { source: ValueSource; m: BrandHubMessages }) {
  const s = m.sources[source]
  return (
    <span
      title={s.explanation}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{
        border: '1px solid var(--color-border)',
        background: 'var(--color-background-alt)',
        color: 'var(--color-text-secondary)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {s.label}
    </span>
  )
}

export function Legend({ m }: { m: BrandHubMessages }) {
  const order: ValueSource[] = ['designSystem', 'calculated', 'platformDefault', 'notSet']
  return (
    <aside
      aria-labelledby="hub-legend"
      className="mb-10 p-4 print:hidden"
      style={{ ...CARD_STYLE, background: 'var(--color-background-alt)' }}
    >
      <p id="hub-legend" className="mb-3 text-sm font-semibold">{m.legendTitle}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {order.map((k) => (
          <li key={k} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <ValueLabel source={k} m={m} />
            <span className="min-w-0 flex-1">{m.sources[k].explanation}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export function Section({ title, children, id }: { title?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-12 first:mt-0">
      {title && (
        <h2 className="mb-5 text-2xl font-semibold" style={HEADING_FONT}>{title}</h2>
      )}
      {children}
    </section>
  )
}

export function RichText({ value }: { value: PortableTextContent | null | undefined }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null
  return (
    <div className="mb-10 max-w-[var(--layout-max-text-width,720px)]" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>
      <PortableText value={value as never} components={articlePortableTextComponents} />
    </div>
  )
}

export function DoDontGrid({ items, m }: { items: DoDontItem[]; m: BrandHubMessages }) {
  if (items.length === 0) return null
  return (
    <Section title={m.examplesTitle}>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => {
          const isDo = it.kind === 'do'
          return (
            <li key={it.key} className="break-inside-avoid overflow-hidden" style={CARD_STYLE}>
              {it.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.imageUrl} alt={it.imageAlt ?? it.caption ?? ''} className="block h-auto w-full" loading="lazy" />
              )}
              <div className="p-4">
                <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {isDo ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
                  {isDo ? m.doLabel : m.dontLabel}
                </p>
                {it.caption && <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{it.caption}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** Written body + do/don't for a page, in the order the spec asks for. */
export function WrittenBlocks({ body, doDont, m, part }: {
  body: PortableTextContent | null
  doDont: DoDontItem[]
  m: BrandHubMessages
  part: 'body' | 'doDont'
}) {
  return part === 'body' ? <RichText value={body} /> : <DoDontGrid items={doDont} m={m} />
}

export function PassFail({ pass, m }: { pass: boolean; m: BrandHubMessages }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium">
      {pass ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
      {pass ? m.pass : m.fail}
    </span>
  )
}

/** A design value with unit, or the "Not set" text. */
export function ValueText({ v, unit = '', locale, m }: { v: DesignValue<number | string>; unit?: string; locale: string; m: BrandHubMessages }) {
  if (v.value === null || v.value === undefined || v.source === 'notSet') {
    return <span>{m.sources.notSet.label}</span>
  }
  const text = typeof v.value === 'number' ? `${formatNumber(locale, v.value)}${unit}` : v.value
  return <span className={typeof v.value === 'string' ? MONO : undefined}>{text}</span>
}

/** Label : value + source pill rows in a definition list. */
export function Spec({ label, children, source, m }: { label: string; children: ReactNode; source?: ValueSource; m: BrandHubMessages }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {label && <dt className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{label}</dt>}
      <dd className="m-0 flex flex-wrap items-center gap-2 text-sm">
        {children}
        {source && <ValueLabel source={source} m={m} />}
      </dd>
    </div>
  )
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto" style={{ ...CARD_STYLE }}>{children}</div>
}

export const TH = 'px-3 py-2 text-left text-sm font-semibold align-top'
export const TD = 'px-3 py-2 text-sm align-top'
