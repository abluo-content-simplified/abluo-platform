import Link from 'next/link'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { getBrandHubMessages } from '@/lib/i18n/brand-hub-messages'
import { BRAND_HUB_NAV_GROUPS, WRITTEN_PAGES, type BrandHubModel, type BrandHubPageId, type WrittenPageId } from '@/lib/modules/brand-hub/types'
import { ColourPage } from './ColourPage'
import { LayoutPage } from './LayoutPage'
import { LogoPage } from './LogoPage'
import { MotionPage } from './MotionPage'
import { VoicePage } from './VoicePage'
import { FoundationPage } from './FoundationPage'
import { UsingPage } from './UsingPage'
import { OverviewPage } from './OverviewPage'
import { ShapePage } from './ShapePage'
import { TypographyPage } from './TypographyPage'
import { PagePager } from './PagePager'
import { IntroDialog } from './IntroDialog'
import { FOCUS_RING, GuideMeta, HEADING_FONT, Legend, StatementStatusPill } from './shared'

const isWritten = (p: BrandHubPageId): p is WrittenPageId => (WRITTEN_PAGES as readonly string[]).includes(p)

const VALUE_PAGES: readonly BrandHubPageId[] = ['colour', 'typography', 'shape', 'layout', 'motion']

export function BrandHub({ model, page, locale, basePath }: {
  model: BrandHubModel
  page: BrandHubPageId
  locale: string
  basePath: string
}) {
  const m = getBrandHubMessages(locale)
  const common = { model, m, locale }
  const hrefFor = (p: BrandHubPageId) => (p === 'overview' ? basePath : `${basePath}/${p}`)

  let content: React.ReactNode
  switch (page) {
    case 'colour': content = <ColourPage {...common} />; break
    case 'typography': content = <TypographyPage {...common} />; break
    case 'shape': content = <ShapePage {...common} />; break
    case 'layout': content = <LayoutPage {...common} />; break
    case 'logo': content = <LogoPage {...common} />; break
    case 'motion': content = <MotionPage {...common} />; break
    case 'voice': content = <VoicePage {...common} />; break
    case 'foundation': content = <FoundationPage {...common} />; break
    case 'using': content = <UsingPage {...common} />; break
    default: content = <OverviewPage {...common} basePath={basePath} />
  }

  return (
    <SectionContainer>
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-12 print:block">
        <nav aria-label={m.pagesNavLabel} className="min-w-0 md:sticky md:top-28 md:w-56 md:shrink-0 print:hidden">
          <p className="mb-3 hidden text-sm font-semibold md:block" style={HEADING_FONT}>{m.navLabel}</p>
          <ul className="-mx-6 flex gap-1 overflow-x-auto px-6 pb-2 md:mx-0 md:flex-col md:gap-5 md:overflow-visible md:px-0 md:pb-0">
            {BRAND_HUB_NAV_GROUPS.map((g) => (
              <li key={g.key} className="flex shrink-0 gap-1 md:flex-col md:gap-0">
                <p className="hidden px-3 pb-1 text-xs font-semibold uppercase tracking-wide md:block" style={{ color: 'var(--color-text-secondary)' }}>{m.navGroups[g.key]}</p>
                <ul className="flex gap-1 md:flex-col md:gap-0">
                  {g.pages.map((p) => {
                    const current = p === page
                    return (
                      <li key={p} className="shrink-0">
                        <Link
                          href={hrefFor(p)}
                          aria-current={current ? 'page' : undefined}
                          className={`block whitespace-nowrap border-b-2 px-3 py-2 text-sm md:border-b-0 md:border-l-2 ${current ? 'font-semibold' : 'font-normal'} ${FOCUS_RING}`}
                          style={{
                            color: current ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                            borderColor: current ? 'var(--color-text-primary)' : 'transparent',
                            textDecoration: current ? 'underline' : 'none',
                            textUnderlineOffset: 4,
                          }}
                        >
                          {m.pages[p].title}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 print:w-full">
          <header className="mb-10">
            <h1 className="mb-3 text-3xl font-semibold md:text-4xl" style={HEADING_FONT}>{m.pages[page].title}</h1>
            <p className="max-w-[var(--layout-max-text-width,720px)] text-lg" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
              {m.pages[page].description}
            </p>
          </header>
          {isWritten(page) && model.written[page].status && (
            <div className="-mt-6 mb-10"><StatementStatusPill status={model.written[page].status!} m={m} /></div>
          )}
          {VALUE_PAGES.includes(page) && <Legend m={m} />}
          {content}
          <PagePager page={page} m={m} hrefFor={hrefFor} />
          <footer className="mt-10 pt-4 text-sm" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <GuideMeta model={model} m={m} locale={locale} />
          </footer>
        </main>
      </div>
      {page !== 'using' && <IntroDialog m={m} basePath={basePath} guideHref={hrefFor('using')} />}
    </SectionContainer>
  )
}
