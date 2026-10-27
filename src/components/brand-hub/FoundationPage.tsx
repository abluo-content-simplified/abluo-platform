import type { BrandList, BrandStatement, BrandStatementKey } from '@/lib/modules/brand-hub/types'
import type { BrandHubMessages } from '@/lib/i18n/brand-hub-messages'
import { CARD_STYLE, HEADING_FONT, Section, StatementStatusPill, type HubPageProps } from './shared'
import { multiline } from '@/lib/multiline-text'

/**
 * Brand foundation (ADR-036 Amendment C). Not a flat grid: mission, vision and
 * promise lead with more weight; positioning reads as prose with its
 * differentiators; audiences, personality and values are lists; the story is
 * prose at reading width. Every section shows its own status; empty sections
 * say "Not written yet" — nothing is invented.
 */
const TEXT_W = 'max-w-[var(--layout-max-text-width,720px)]'
const BODY = { color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' } as const
const MUTED = { color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' } as const

function Paragraphs({ text, className = '', style = BODY }: { text: string; className?: string; style?: React.CSSProperties }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i} className={`mb-3 whitespace-pre-line last:mb-0 ${className}`} style={style}>{p}</p>
      ))}
    </>
  )
}

function Heading({ title, status, m, id }: { title: string; status: BrandStatement['status']; m: BrandHubMessages; id: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <h2 id={id} className="text-2xl font-semibold" style={HEADING_FONT}>{title}</h2>
      <StatementStatusPill status={status} m={m} />
    </div>
  )
}

const NotWritten = ({ m }: { m: BrandHubMessages }) => <p className="text-sm" style={MUTED}>{m.notWritten}</p>

function Lead({ s, m }: { s: BrandStatement<BrandStatementKey>; m: BrandHubMessages }) {
  return (
    <div className="break-inside-avoid p-6" style={CARD_STYLE}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide" style={MUTED}>{m.foundation[s.key]}</p>
        <StatementStatusPill status={s.status} m={m} />
      </div>
      {s.text ? <p className="text-xl font-semibold leading-snug md:text-2xl" style={HEADING_FONT}>{s.text}</p> : <NotWritten m={m} />}
    </div>
  )
}

function ListSection({ list, m, columns = 2, noteLabel }: { list: BrandList; m: BrandHubMessages; columns?: 1 | 2 | 3; noteLabel?: string }) {
  const id = `foundation-${list.key}`
  const grid = columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : ''
  return (
    <section aria-labelledby={id} className="mt-14">
      <Heading id={id} title={m.foundation[list.key]} status={list.status} m={m} />
      {list.intro && <div className={`mb-5 ${TEXT_W}`}><Paragraphs text={list.intro} /></div>}
      {list.items.length > 0 && (
        <ul className={`grid gap-4 ${grid}`}>
          {list.items.map((it) => (
            <li key={it.key} className="break-inside-avoid p-5" style={CARD_STYLE}>
              <h3 className="mb-1.5 text-lg font-semibold" style={HEADING_FONT}>{it.title}</h3>
              {it.text && <Paragraphs text={it.text} className="text-[0.9375rem]" />}
              {it.note && (
                <p className={multiline('mt-3 text-sm')} style={MUTED}>
                  {noteLabel && <span className="font-semibold">{noteLabel} </span>}
                  {it.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.outro && <div className={`mt-5 ${TEXT_W}`}><Paragraphs text={list.outro} /></div>}
      {!list.intro && !list.outro && list.items.length === 0 && <NotWritten m={m} />}
    </section>
  )
}

function ProseSection({ s, m }: { s: BrandStatement<BrandStatementKey>; m: BrandHubMessages }) {
  const id = `foundation-${s.key}`
  return (
    <section aria-labelledby={id} className="mt-14">
      <Heading id={id} title={m.foundation[s.key]} status={s.status} m={m} />
      <div className={TEXT_W}>{s.text ? <Paragraphs text={s.text} className="text-[1.0625rem] leading-relaxed" /> : <NotWritten m={m} />}</div>
    </section>
  )
}

export function FoundationPage({ model, m }: HubPageProps) {
  const st = (k: BrandStatementKey) => model.statements.find((s) => s.key === k)!
  const li = (k: BrandList['key']) => model.lists.find((l) => l.key === k)!
  const promise = st('promise')
  const [promiseLine, ...promiseRest] = (promise.text ?? '').split(/\n\s*\n/)

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Lead s={st('mission')} m={m} />
        <Lead s={st('vision')} m={m} />
      </div>

      <Section>
        <div className="mt-8 break-inside-avoid p-6 md:p-8" style={{ ...CARD_STYLE, background: 'var(--color-background-alt)' }}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm font-semibold uppercase tracking-wide" style={MUTED}>{m.foundation.promise}</p>
            <StatementStatusPill status={promise.status} m={m} />
          </div>
          {promise.text ? (
            <>
              <p className="mb-3 text-2xl font-semibold leading-snug md:text-3xl" style={HEADING_FONT}>{promiseLine}</p>
              {promiseRest.length > 0 && <div className={TEXT_W}><Paragraphs text={promiseRest.join('\n\n')} /></div>}
            </>
          ) : <NotWritten m={m} />}
        </div>
      </Section>

      <ListSection list={li('audience')} m={m} columns={3} />
      <ProseSection s={st('positioning')} m={m} />
      <ListSection list={li('differentiators')} m={m} columns={2} />
      <ListSection list={li('personality')} m={m} columns={3} noteLabel={m.notLabel} />
      <ProseSection s={st('story')} m={m} />
      <ListSection list={li('values')} m={m} columns={1} noteLabel={m.questionLabel} />
    </>
  )
}
