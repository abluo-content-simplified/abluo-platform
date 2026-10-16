import Link from 'next/link'
import { BRAND_HUB_PAGES } from '@/lib/modules/brand-hub/types'
import { CARD_STYLE, FOCUS_RING, HEADING_FONT, RichText, Section, formatDate, themeBackground, type HubPageProps } from './shared'
import { formatBrandHubMessage } from '@/lib/i18n/brand-hub-messages'

export function OverviewPage({ model, m, locale, basePath }: HubPageProps & { basePath: string }) {
  const dark = model.assets.find((a) => a.key === 'logo')
  const light = model.assets.find((a) => a.key === 'logoLight')
  const logo = dark ?? light
  const logoBg = logo ? themeBackground(model, logo === dark ? 'dark' : 'light') : undefined
  const date = model.lastUpdated ? formatDate(model.lastUpdated, locale, model.timeZone) : ''

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
          {model.version === null ? m.notVersioned : formatBrandHubMessage(m.version, { version: model.version })}
          {date && ` · ${formatBrandHubMessage(m.lastUpdated, { date })}`}
        </p>
      </Section>

      <Section>
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
