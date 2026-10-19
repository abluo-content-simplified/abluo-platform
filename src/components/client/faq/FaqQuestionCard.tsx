'use client'

import { useId, useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { PortableTextBlock } from '@portabletext/editor'
import type { FaqEntryValue } from '@/lib/api/faq-sets'
import { normalizeFaqAnswer } from '@/lib/faq/answer-blocks'
import { BodyEditor, type LinkTools } from '@/components/client/editor/BodyEditor'
import { DragGrip, DropLine } from '@/components/app/ui/DragGrip'
import { IconButton } from '@/components/app/ui/Button'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { Panel } from '@/components/app/ui/Panel'
import { Pill } from '@/components/app/ui/list/cells'
import { TextInput } from '@/components/app/ui/TextInput'
import type { DropEdge, GripProps } from '@/components/app/ui/use-pointer-drag'
import { FAQ_ICONS, FAQ_UI_LIMITS } from './faq-bits'

/** True when a Portable Text value has any text (an empty paragraph is not an answer). */
export function hasAnswerText(blocks: PortableTextBlock[] | undefined): boolean {
  return (blocks ?? []).some((b) => {
    const children = (b as { children?: { text?: unknown }[] }).children
    return Array.isArray(children) ? children.some((c) => typeof c?.text === 'string' && c.text.trim() !== '') : b._type !== 'block'
  })
}

/** The answer as plain paragraphs (read-only view). */
function answerParagraphs(blocks: PortableTextBlock[] | undefined): string[] {
  return (blocks ?? [])
    .map((b) => {
      const children = (b as { children?: { text?: unknown }[] }).children
      return Array.isArray(children) ? children.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('') : ''
    })
    .filter((x) => x.trim() !== '')
}

/** The entry is complete in `locale`: a question and an answer. */
export function isTranslated(entry: FaqEntryValue, locale: string): boolean {
  return Boolean(entry.question[locale]?.trim()) && hasAnswerText(entry.answer[locale])
}

/**
 * One question of an FAQ set, as a card (ADR-037 D9): the question (plain
 * text) and its answer (restricted rich text, D12) in the selected language,
 * with a drag grip (pointer drag or ArrowUp / ArrowDown) and Remove. When
 * editing another language than the site's default, the default-language
 * question is shown as a reference and an incomplete card is marked
 * "Not translated". Content is top-aligned.
 */
export function FaqQuestionCard({
  entry,
  index,
  total,
  locale,
  defaultLocale,
  languageName,
  readOnly,
  links,
  generation,
  drag,
  edge,
  dragging,
  rowProps,
  onQuestion,
  onAnswer,
  onRemove,
  onMove,
}: {
  entry: FaqEntryValue
  index: number
  total: number
  /** The language being edited. */
  locale: string
  defaultLocale: string
  languageName: (code: string) => string
  readOnly: boolean
  links?: LinkTools
  /** Bumped when the set is reloaded from the server: remounts the answer editors with the new value. */
  generation: number
  drag: GripProps
  edge: DropEdge | null
  dragging: boolean
  rowProps: { 'data-drag-key': string }
  onQuestion: (value: string) => void
  onAnswer: (value: PortableTextBlock[]) => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const t = useTranslations('clientDashboard.faq.editor')
  const id = useId()
  /**
   * The answer editor may normalise its value on mount; only changes made
   * after the person reaches the field (in this language, since the last
   * reload) count, so opening a published set never creates a draft by itself.
   */
  const touched = useRef('')
  const mount = `${locale}:${generation}`
  const translating = locale !== defaultLocale
  const question = entry.question[locale] ?? ''
  const reference = translating ? entry.question[defaultLocale]?.trim() : ''
  const label = question.trim() || reference || t('untitledQuestion', { n: index + 1 })
  const missing = translating && !isTranslated(entry, locale)

  return (
    <Panel as="li" padding="none" className={`relative ${dragging ? 'opacity-50' : ''}`} {...rowProps}>
      <DropLine edge={edge} />
      <div className="flex items-start gap-1 p-2 pr-2 md:p-3">
        {readOnly ? null : (
          <DragGrip
            label={t('drag', { question: label, position: index + 1, total })}
            drag={drag}
            onMove={onMove}
            className="mt-1"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1 pb-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="pt-2 text-sm leading-5 font-medium text-muted-foreground tabular-nums">{t('questionNumber', { n: index + 1, total })}</span>
            {missing ? <Pill tone="highlight">{t('notTranslated', { language: languageName(locale) })}</Pill> : null}
          </div>
          <div>
            <FieldLabel htmlFor={`${id}-q`} hint={reference ? t('reference', { language: languageName(defaultLocale), text: reference }) : undefined} hintId={reference ? `${id}-ref` : undefined}>
              {t('question')}
            </FieldLabel>
            <TextInput
              id={`${id}-q`}
              value={question}
              readOnly={readOnly}
              maxLength={FAQ_UI_LIMITS.question}
              placeholder={reference || t('questionPlaceholder')}
              aria-describedby={reference ? `${id}-ref` : undefined}
              onChange={(e) => onQuestion(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel as="p" id={`${id}-a`} hint={readOnly ? undefined : t('answerHint')}>
              {t('answer')}
            </FieldLabel>
            {readOnly ? (
              <div className="mt-1.5 space-y-2 text-[0.9375rem] leading-6 text-foreground" aria-labelledby={`${id}-a`}>
                {answerParagraphs(entry.answer[locale]).map((line, n) => (
                  <p key={n}>{line}</p>
                ))}
              </div>
            ) : (
              <div
                className="mt-1.5 rounded-xl border border-border px-3"
                onFocusCapture={() => {
                  touched.current = mount
                }}
                onPointerDownCapture={() => {
                  touched.current = mount
                }}
              >
                <BodyEditor
                  key={`${entry._key}:${locale}:${generation}`}
                  variant="faqAnswer"
                  label={t('answerLabel', { question: label })}
                  initialValue={entry.answer[locale]}
                  placeholder={t('answerPlaceholder')}
                  links={links}
                  onChange={(value) => {
                    if (touched.current === mount) onAnswer(normalizeFaqAnswer(value ?? []) as unknown as PortableTextBlock[])
                  }}
                />
              </div>
            )}
          </div>
        </div>
        {readOnly ? null : (
          <IconButton aria-label={t('remove', { question: label })} onClick={onRemove} className="text-muted-foreground">
            {FAQ_ICONS.trash}
          </IconButton>
        )}
      </div>
    </Panel>
  )
}
