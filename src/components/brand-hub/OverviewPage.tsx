import Link from 'next/link'
import { BRAND_HUB_PAGES } from '@/lib/modules/brand-hub/types'
import { CARD_STYLE, FOCUS_RING, GuideMeta, HEADING_FONT, RichText, Section, StatementCard, formatDate, themeBackground, type HubPageProps } from './shared'

/**
 * Overview — introduces the brand first (who it is, mission, vision, promise,
 * audience, positioning, personality, values, story), then how to use the
 * guidelines, recent changes and the page directory. Every statement slot is
 * always shown: unwritten ones say so, drafts are marked (ADR-036 amendment,
 * 2026-10-17). Nothing here is invented — text comes from the brand guide.
 */
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
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <GuideMeta model={model} m={m} locale={locale} />
        </p>
      </Section>

      <Section title={m.aboutTitle} id="about">
        <ul className="grid gap-4 sm:grid-cols-2">
          {model.statements.map((s) => (
            <StatementCard key={s.key} title={m.statements[s.key]} statement={s} m={m} />
          ))}
        </ul>
      </Section>

      <Section title={m.howToUseTitle} id="how-to-use">
        {model.howToUse ? (
          <RichText value={model.howToUse} />
        ) : (
          <p className="mb-10 max-w-[var(--layout-max-text-width,720px)]" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>
            {m.howToUseDefault}
          </p>
        )}
      </Section>

      {model.changes.length > 0 && (
        <Section title={m.changesTitle} id="changes">
          <ul className="flex flex-col gap-2">
            {model.changes.map((c) => (
              <li key={c.key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                <span className="shrink-0 text-sm sm:w-40" style={{ color: 'var(--color-text-secondary)' }}>
                  {formatDate(`${c.date}T12:00:00Z`, locale, 'UTC')}
                </span>
                <span className="text-[0.9375rem]" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>{c.note}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={m.guidesTitle} id="guidelines">
        <ul className="grid gap-4 sm:grid-cols-2">
          {BRAND_HUB_PAGES.filter((p) => p !== 'overview').map((p) => (
            <li key={p} className="break-inside-avoid">
              <Link
                href={`${basePath}/${p}`}
                className={`block h-full p-5 ${FOCUS_RING}`}
                style={CARD_STYLE}
              >
                <h3 className="mb-1 text-lg font-semibold" style={HEADING_FONT}>{m.pages[p].title}</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{m.pages[p].description}</p>
                <span className="sr-only">{m.openPage}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}
