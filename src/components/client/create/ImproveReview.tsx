'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { PreservedChip } from '@/components/client/editor/BodyEditor'
import { cleanLink, isSpan, isTextBlock, type BodyBlock, type BodyItem, type BodyObject, type BodySpan } from '@/lib/client/normalize-blocks'

/**
 * "Improve with AI" review (ADR-025 · Tell your story). The writer sees their
 * own text and the suggestion — stacked on a phone, side by side from `md` —
 * and either takes the new version or keeps theirs. A native <dialog>: full
 * screen on a phone, a calm centred sheet on larger screens. Nothing changes
 * until "Use this version" is pressed; Escape / "Keep mine" leave the text as is.
 */
export function ImproveReview({
  open,
  original,
  suggestion,
  onAccept,
  onKeep,
}: {
  open: boolean
  original: BodyItem[]
  suggestion: BodyItem[]
  onAccept: () => void
  onKeep: () => void
}) {
  const t = useTranslations('clientDashboard.create.story.improve')
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="improve-review-title"
      // Escape fires `cancel`: treat it as "Keep mine" so parent state stays in sync.
      onCancel={(e) => {
        e.preventDefault()
        onKeep()
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-foreground/30 md:m-auto md:h-auto md:max-h-[85dvh] md:max-w-5xl md:rounded-2xl md:border md:border-border"
    >
      {open && (
        <div className="flex h-full flex-col md:max-h-[85dvh]">
          <header className="px-4 pt-6 pb-4 md:px-8 md:pt-8">
            <h2 id="improve-review-title" className="text-2xl font-semibold tracking-tight">
              {t('title')}
            </h2>
            <p className="mt-2 text-[17px] leading-7 text-muted-foreground">{t('helper')}</p>
          </header>

          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 pb-4 md:grid-cols-2 md:gap-6 md:px-8">
            <Version label={t('yours')}>
              <BlocksPreview blocks={original} />
            </Version>
            <Version label={t('suggestion')} highlight>
              <BlocksPreview blocks={suggestion} />
            </Version>
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-border-subtle px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:flex-row md:justify-end md:px-8 md:pb-6">
            <button
              type="button"
              onClick={onKeep}
              className="min-h-12 rounded-xl px-5 text-[17px] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('keep')}
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="min-h-12 rounded-xl bg-action px-5 text-[17px] font-medium text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {t('accept')}
            </button>
          </footer>
        </div>
      )}
    </dialog>
  )
}

function Version({ label, highlight, children }: { label: string; highlight?: boolean; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className={`rounded-xl border p-4 md:p-5 ${highlight ? 'border-border bg-selected-tint' : 'border-border-subtle bg-muted'}`}
    >
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">{label}</h3>
      <div className="text-[17px] leading-7 text-foreground">{children}</div>
    </section>
  )
}

function Spans({ block }: { block: BodyBlock }) {
  const links = new Set(block.markDefs.map((d) => cleanLink(d)?._key).filter(Boolean))
  return (
    <>
      {block.children.map((c) => {
        if (!isSpan(c)) return <PreservedChip key={c._key} value={c as BodyObject} inline />
        const s: BodySpan = c
        let node: ReactNode = s.text
        if (s.marks.includes('em')) node = <em>{node}</em>
        if (s.marks.includes('strong')) node = <strong className="font-semibold">{node}</strong>
        if (s.marks.some((m) => links.has(m))) node = <span className="underline underline-offset-2">{node}</span>
        return <span key={s._key}>{node}</span>
      })}
    </>
  )
}

/** Read-only rendering of a normalised body (the shapes `normalizeBlocks` emits). */
export function BlocksPreview({ blocks }: { blocks: BodyItem[] }) {
  const out: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (!isTextBlock(b)) {
      out.push(
        <div key={b._key} className="my-3">
          <PreservedChip value={b} />
        </div>,
      )
      continue
    }
    if (b.listItem) {
      const type = b.listItem
      const items: BodyBlock[] = []
      for (let next = blocks[i]; i < blocks.length && isTextBlock(next) && next.listItem === type; next = blocks[++i]) items.push(next)
      i--
      const List = type === 'number' ? 'ol' : 'ul'
      out.push(
        <List key={b._key} className={`my-3 pl-6 ${type === 'number' ? 'list-decimal' : 'list-disc'} marker:text-muted-foreground`}>
          {items.map((it) => (
            <li key={it._key} style={{ marginInlineStart: `${((it.level ?? 1) - 1) * 1.5}rem` }} className="my-1">
              <Spans block={it} />
            </li>
          ))}
        </List>,
      )
      continue
    }
    const content = <Spans block={b} />
    if (b.style === 'h1' || b.style === 'h2') out.push(<h4 key={b._key} className="mt-5 mb-2 text-xl font-semibold tracking-tight">{content}</h4>)
    else if (/^h[3-6]$/.test(b.style)) out.push(<h5 key={b._key} className="mt-4 mb-1 text-lg font-semibold">{content}</h5>)
    else if (b.style === 'blockquote')
      out.push(
        <blockquote key={b._key} className="my-3 border-l-[3px] border-foreground/30 pl-4 italic text-foreground/80">
          {content}
        </blockquote>,
      )
    else out.push(<p key={b._key} className="my-3 first:mt-0">{content}</p>)
  }
  return <>{out}</>
}
