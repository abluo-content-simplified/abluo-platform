'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { PortableTextBlock } from '@portabletext/editor'
import { BodyEditor } from '@/components/client/editor/BodyEditor'
import { useLinkTools } from '@/components/client/create/use-link-tools'
import { ImproveReview } from '@/components/client/create/ImproveReview'
import type { StepProps } from '@/components/client/create/types'
import {
  asEditorValue,
  countWords,
  normalizeBlocks,
  readingMinutes,
  textToBlocks,
  hasPreservedContent,
  type BodyItem,
} from '@/lib/client/normalize-blocks'

/** Below this many words "Improve" has too little to work with. */
export const IMPROVE_MIN_WORDS = 30

export type ImproveResult = { ok: true; blocks: PortableTextBlock[] } | { ok: false; error: string }

export type StoryStepProps = StepProps & {
  /**
   * Asks the AI for an improved version of the body. When omitted (AI_FEATURES
   * off) the button shows disabled with a "Coming soon" badge.
   * Receives the normalised current body; the returned blocks are normalised
   * again before they are shown or saved, so the server shape is guaranteed.
   */
  onImprove?: (blocks: PortableTextBlock[]) => Promise<ImproveResult>
}

type Notice = { kind: 'hint' | 'error'; text: string } | null

/**
 * Create flow · "Tell your story" (ADR-025). One question, one calm writing
 * area. Every change is normalised to the server's body shape and handed to
 * the shell via `update({ 'body.<locale>': blocks })`; the shell autosaves.
 */
export function StoryStep({ draft, site, locale, update, onImprove }: StoryStepProps) {
  const t = useTranslations('clientDashboard.create.story')
  const path = `body.${locale}`

  // An existing post's body is its own reference: everything stored loads untouched.
  const [seed, setSeed] = useState<BodyItem[]>(() => normalizeBlocks(draft.body[locale], draft.body[locale]))
  const [current, setCurrent] = useState<BodyItem[]>(seed)
  // Last body handed to the shell — the reference that decides which preserved
  // content (images, h1/h4, Studio-only annotations) may stay. Mirrors the server.
  const latest = useRef<BodyItem[]>(seed)
  // Bumped to remount the editor with new content (paste, accepted AI version).
  const [editorKey, setEditorKey] = useState(0)
  const [notice, setNotice] = useState<Notice>(null)
  const [improving, setImproving] = useState(false)
  const [suggestion, setSuggestion] = useState<BodyItem[] | null>(null)

  // Links: the site's own hosts decide "new tab"; "A page on your site" searches this project only.
  const links = useLinkTools(site.projectSlug, locale)

  const words = countWords(current)
  const minutes = readingMinutes(words)

  const commit = (blocks: BodyItem[]) => {
    latest.current = blocks
    setCurrent(blocks)
    update({ [path]: blocks })
  }

  const replaceContent = (blocks: BodyItem[]) => {
    commit(blocks)
    setSeed(blocks)
    setEditorKey((k) => k + 1)
  }

  const pasteText = async () => {
    setNotice(null)
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setNotice({ kind: 'hint', text: t('paste.fallback') })
      return
    }
    try {
      const pasted = textToBlocks(await navigator.clipboard.readText())
      if (!pasted.length) {
        setNotice({ kind: 'hint', text: t('paste.empty') })
        return
      }
      replaceContent(normalizeBlocks([...latest.current, ...pasted], latest.current))
      setNotice({ kind: 'hint', text: t('paste.done') })
    } catch {
      // Permission denied or not a user gesture on this browser.
      setNotice({ kind: 'hint', text: t('paste.fallback') })
    }
  }

  const improve = async () => {
    if (!onImprove || improving || words < IMPROVE_MIN_WORDS || preservedContent) return
    setNotice(null)
    setImproving(true)
    try {
      // The AI sees the supported shape only (h1 → h2, h4 → h3; links kept).
      const result = await onImprove(asEditorValue(normalizeBlocks(current)))
      const blocks = result.ok ? normalizeBlocks(result.blocks) : []
      if (!result.ok || !blocks.length) setNotice({ kind: 'error', text: t('improve.failed') })
      else setSuggestion(blocks)
    } catch {
      setNotice({ kind: 'error', text: t('improve.failed') })
    } finally {
      setImproving(false)
    }
  }

  const tooShort = words < IMPROVE_MIN_WORDS
  // Accepting a rewrite would drop images / Studio-only content — not offered for those posts.
  const preservedContent = hasPreservedContent(current)

  return (
    <section aria-labelledby="story-step-title" className="flex min-h-0 flex-1 flex-col">
      <h1 id="story-step-title" className="text-[1.875rem] leading-9 font-semibold tracking-tight text-foreground">
        {t('title')}
      </h1>
      <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground">{t('helper')}</p>

      <div className="mt-8 flex min-h-0 flex-1 flex-col">
        <BodyEditor
          key={`${locale}:${editorKey}`}
          initialValue={asEditorValue(seed)}
          placeholder={t('placeholder')}
          links={links}
          onChange={(value) => commit(normalizeBlocks(value, latest.current))}
        />
      </div>

      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {words > 0 ? t('stats', { words, minutes }) : t('statsEmpty')}
      </p>

      <div role="group" aria-label={t('actions.label')} className="mt-4 flex flex-wrap gap-2">
        <Action onPress={pasteText} icon={ICONS.paste}>
          {t('actions.paste')}
        </Action>
        <Action disabled icon={ICONS.mic} badge={t('actions.soon')}>
          {t('actions.dictate')}
        </Action>
        {onImprove && (
          <Action
            onPress={improve}
            disabled={tooShort || improving || preservedContent}
            busy={improving}
            icon={ICONS.sparkle}
            describedBy={tooShort || preservedContent ? 'story-improve-hint' : undefined}
            primary
          >
            {improving ? t('improve.loading') : t('actions.improve')}
          </Action>
        )}
        {!onImprove && (
          <Action disabled icon={ICONS.sparkle} badge={t('actions.soon')}>
            {t('actions.improve')}
          </Action>
        )}
      </div>

      {onImprove && (tooShort || preservedContent) && (
        <p id="story-improve-hint" className="mt-2 text-sm text-muted-foreground">
          {preservedContent ? t('improve.preserved') : t('improve.tooShort', { count: IMPROVE_MIN_WORDS })}
        </p>
      )}

      <p role="status" className={`mt-2 min-h-5 text-sm ${notice?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
        {notice?.text}
      </p>

      <ImproveReview
        open={suggestion !== null}
        original={current}
        suggestion={suggestion ?? []}
        onKeep={() => setSuggestion(null)}
        onAccept={() => {
          if (suggestion) replaceContent(suggestion)
          setSuggestion(null)
        }}
      />
    </section>
  )
}

function svg(d: string) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  paste: svg('M9 4h6v3H9zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 12h6M9 16h4'),
  mic: svg('M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3'),
  sparkle: svg('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'),
}

function Action({
  children,
  icon,
  onPress,
  disabled,
  busy,
  badge,
  primary,
  describedBy,
}: {
  children: ReactNode
  icon: ReactNode
  onPress?: () => void
  disabled?: boolean
  busy?: boolean
  badge?: string
  primary?: boolean
  describedBy?: string
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-describedby={describedBy}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[0.9375rem] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
        primary
          ? 'border-transparent bg-accent text-accent-foreground enabled:hover:bg-hover'
          : 'border-border bg-background text-foreground enabled:hover:bg-hover'
      }`}
    >
      <span className={busy ? 'animate-pulse' : undefined}>{icon}</span>
      {children}
      {badge && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{badge}</span>}
    </button>
  )
}
