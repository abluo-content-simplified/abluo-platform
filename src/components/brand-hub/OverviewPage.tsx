import Link from 'next/link'
import type { BrandHubPageId } from '@/lib/modules/brand-hub/types'
import { CARD_STYLE, FOCUS_RING, GuideMeta, HEADING_FONT, RichText, Section, formatDate, themeBackground, type HubPageProps } from './shared'

/**
 * Overview (ADR-036 Amendment C) — the brand's logo, name and intro, a single
 * link to "Using the Brand Hub", task shortcuts, the guideline pages grouped by
 * purpose, and recent changes. The brand foundation (mission, vision, …) has
 * its own page. Nothing here is invented — text comes from the brand guide.
 */
const DIRECTORY: readonly { key: 'brand' | 'visual' | 'resources'; pages: readonly BrandHubPageId[] }[] = [
  { key: 'brand', pages: ['foundation', 'voice'] },
  { key: 'visual', pages: ['colour', 'typography', 'shape', 'layout', 'motion'] },
  { key: 'resources', pages: ['logo'] },
]

const SHORTCUTS: readonly { key: 'logo' | 'colour' | 'copy' | 'interface' | 'accessibility'; href: string }[] = [
  { key: 'logo', href: 'logo' },
  { key: 'colour', href: 'colour' },
  { key: 'copy', href: 'voice' },
  { key: 'interface', href: 'colour#tokens' },
  { key: 'accessibility', href: 'colour#contrast' },
]

const MUTED = { color: 'var(--color-text-secondary)' } as const

export function OverviewPage({ model, m, locale, basePath }: HubPageProps & { basePath: string }) {
  const dark = model.assets.find((a) => a.key === 'logo')
  const light = model.assets.find((a) => a.key === 'logoLight')
  const logo = dark ?? light
  const logoBg = logo ? themeBackground(model, logo === dark ? 'dark' : 'light') : undefined

  return (
    <>
      <Section>
        {logo && (
          <div className="mb-8 flex items-center justify-center p-8 sm:p-12" style={{ ...CARD_STYLE, background: logoBg ?? CARD_STYLE.background }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo.previewUrl} alt={model.projectName ?? m.assetLabels.logo} className="block h-auto max-h-32 w-auto max-w-full" />
          </div>
        )}
        {model.projectName && (
          <h2 className="mb-3 text-2xl font-semibold" style={HEADING_FONT}>{model.projectName}</h2>
        )}
        <RichText value={model.intro} />
        <p className="text-sm" style={MUTED}>
          <GuideMeta model={model} m={m} locale={locale} />
        </p>
      </Section>

      <Section title={m.shortcutsTitle} id="shortcuts">
        <ul className="flex flex-wrap gap-2 print:hidden">
          {SHORTCUTS.map((s) => (
            <li key={s.key}>
              <Link
                href={`${basePath}/${s.href}`}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-[0.9375rem] font-medium ${FOCUS_RING}`}
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}
              >
                {m.shortcuts[s.key]}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={m.guidesTitle} id="guidelines">
        <div className="flex flex-col gap-8">
          {DIRECTORY.map((g) => (
            <section key={g.key} aria-labelledby={`directory-${g.key}`}>
              <h3 id={`directory-${g.key}`} className="mb-3 text-sm font-semibold uppercase tracking-wide" style={MUTED}>{m.directoryGroups[g.key]}</h3>
              <ul className="grid gap-4 sm:grid-cols-2">
                {g.pages.map((p) => (
                  <li key={p} className="break-inside-avoid">
                    <Link href={`${basePath}/${p}`} className={`block h-full p-5 ${FOCUS_RING}`} style={CARD_STYLE}>
                      <span className="mb-1 block text-lg font-semibold" style={HEADING_FONT}>{m.pages[p].title}</span>
                      <span className="block text-sm" style={MUTED}>{m.pages[p].description}</span>
                      <span className="sr-only"> · {m.openPage}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Section>

      {model.changes.length > 0 && (
        <Section title={m.changesTitle} id="changes">
          <ul className="flex flex-col gap-2">
            {model.changes.map((c) => (
              <li key={c.key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                <span className="shrink-0 text-sm sm:w-40" style={MUTED}>
                  {formatDate(`${c.date}T12:00:00Z`, locale, 'UTC')}
                </span>
                <span className="text-[0.9375rem]" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>{c.note}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}
