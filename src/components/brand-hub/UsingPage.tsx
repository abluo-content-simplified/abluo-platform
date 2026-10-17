import type { BrandStatementStatus, ValueSource } from '@/lib/modules/brand-hub/types'
import { CARD_STYLE, RichText, Section, StatementStatusPill, ValueLabel, type HubPageProps } from './shared'

/**
 * "Using the Brand Hub" (ADR-036 Amendment C) — the same explanations for every
 * project (platform dictionary), plus an optional "For this brand" block from
 * the guide (howToUse): who approves, languages, who to contact.
 */
const TEXT_W = 'max-w-[var(--layout-max-text-width,720px)]'
const BODY = { color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' } as const

export function UsingPage({ model, m }: HubPageProps) {
  const u = m.using
  const statuses: BrandStatementStatus[] = ['approved', 'draft', 'needsDecision']
  const sources: ValueSource[] = ['designSystem', 'calculated', 'platformDefault', 'notSet']
  const plain = (title: string, text: string, id: string) => (
    <Section title={title} id={id}>
      <p className={TEXT_W} style={BODY}>{text}</p>
    </Section>
  )
  return (
    <>
      {plain(u.whoTitle, u.who, 'who')}
      <Section title={u.statusesTitle} id="statuses">
        <p className={`mb-4 ${TEXT_W}`} style={BODY}>{u.statusesIntro}</p>
        <ul className="flex flex-col gap-3">
          {statuses.map((s) => (
            <li key={s} className="flex flex-wrap items-start gap-3 p-4" style={CARD_STYLE}>
              <StatementStatusPill status={s} m={m} />
              <span className="min-w-0 flex-1 text-[0.9375rem]" style={BODY}>{u.statusExplain[s]}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={u.sourcesTitle} id="sources">
        <p className={`mb-4 ${TEXT_W}`} style={BODY}>{u.sourcesIntro}</p>
        <ul className="flex flex-col gap-3">
          {sources.map((s) => (
            <li key={s} className="flex flex-wrap items-start gap-3 p-4" style={CARD_STYLE}>
              <ValueLabel source={s} m={m} />
              <span className="min-w-0 flex-1 text-[0.9375rem]" style={BODY}>{m.sources[s].explanation}</span>
            </li>
          ))}
        </ul>
      </Section>
      {plain(u.previewsTitle, u.previews, 'previews')}
      {plain(u.copyTitle, u.copy, 'copy')}
      {plain(u.versionsTitle, u.versions, 'versions')}
      {plain(u.missingTitle, u.missing, 'missing')}
      {plain(u.languagesTitle, u.languages, 'languages')}
      {plain(u.correctionsTitle, u.corrections, 'corrections')}
      {model.howToUse && (
        <Section title={u.thisBrandTitle} id="this-brand">
          <RichText value={model.howToUse} />
        </Section>
      )}
    </>
  )
}
