'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { Button } from '@/components/app/ui/Button'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { DragGrip, DropLine } from '@/components/app/ui/DragGrip'
import { dropIndex, usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { Panel } from '@/components/app/ui/Panel'
import { Pill } from '@/components/app/ui/list/cells'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { FaqPickSheet } from '@/components/client/faq/post/FaqPickSheet'
import { getFaqMessages } from '@/lib/i18n/faq-messages'
import { moveFaqSet } from '@/lib/client/wizard-steps'

/** Mirrors LIMITS in post-drafts.ts (server code, not importable here); the server re-checks. */
const MAX_SETS = 10
const TITLE_MAX = 200
const SUBTITLE_MAX = 500

/**
 * "Add FAQs to this post?" (ADR-037 D5 / D9) — overview-only screen, shown
 * after the gallery on sites with the FAQ module. The attached FAQ sets in
 * order (drag or arrow keys to reorder, remove, open in the library), "Add
 * FAQs" (choose an existing set or create a new one, FaqPickSheet), and the
 * post's own FAQ heading per language — empty = the website default heading,
 * shown as the placeholder. Saved as `faqSets`, `faqTitle.<loc>` and
 * `faqSubtitle.<loc>` on the post draft; the server checks every set belongs
 * to this project.
 */
export function FaqStep({ draft, site, update, flush, upsertFaqSet }: StepProps) {
  const t = useTranslations('clientDashboard.faq.post')
  const ui = useLocale()
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)
  const attached = draft.faqSets ?? []
  const sets = site.faqSets ?? []
  const byId = new Map(sets.map((s) => [s.id, s]))
  const d = site.defaultLocale
  // The heading is edited in the main language and in every other language this post is written in.
  const headingLanguages = [
    d,
    ...site.languages.filter((l) => l !== d && (draft.title[l]?.trim() || draft.faqTitle?.[l]?.trim() || draft.faqSubtitle?.[l]?.trim())),
  ]
  const [chosenLang, setLang] = useState(d)
  const lang = headingLanguages.includes(chosenLang) ? chosenLang : d

  const setList = (next: string[]) => update({ faqSets: next })
  const drag = usePointerDrag((key, over) => {
    const at = dropIndex(attached, key, over)
    if (at === null) return
    const rest = attached.filter((k) => k !== key)
    rest.splice(at, 0, key)
    setList(rest)
  })

  async function openInLibrary(id: string) {
    // Everything typed so far is saved before leaving the editor.
    await flush?.()
    router.push(`/${site.projectSlug}/faq-sets/${id}`)
  }

  const full = attached.length >= MAX_SETS
  const addButton = (
    <Button variant="secondary" onClick={() => setSheetOpen(true)} disabled={full} aria-describedby={full ? 'faq-step-full' : undefined}>
      {t('add')}
    </Button>
  )

  return (
    <section aria-labelledby="faq-step-title">
      <StepHeading id="faq-step-title" title={t('title')} helper={t('helper')} />

      {attached.length === 0 ? (
        <EmptyState className="mt-8" compact title={t('emptyTitle')} body={t('emptyBody')} action={addButton} />
      ) : (
        <>
          <ul className="mt-8 flex flex-col gap-3" aria-label={t('listLabel')}>
            {attached.map((id, n) => {
              const set = byId.get(id)
              const name = set?.name ?? t('unknownSet')
              return (
                <Panel
                  as="li"
                  key={id}
                  data-drag-key={id}
                  padding="none"
                  className={`relative flex items-start gap-1 p-1 ${drag.dragging === id ? 'opacity-50' : ''}`}
                >
                  <DropLine edge={drag.edge(id)} />
                  {attached.length > 1 ? (
                    <DragGrip
                      label={t('move', { name, position: n + 1, total: attached.length })}
                      drag={drag.gripProps(id)}
                      onMove={(dir) => setList(moveFaqSet(attached, id, dir))}
                    />
                  ) : null}
                  <div className={`flex min-w-0 flex-1 flex-col items-start gap-1 py-2 ${attached.length > 1 ? '' : 'pl-3'}`}>
                    <span className="text-[1rem] font-medium text-foreground">{name}</span>
                    {set ? <span className="text-[0.9375rem] text-muted-foreground">{t('questions', { count: set.count })}</span> : null}
                    {set?.state === 'draft' ? <Pill tone="highlight">{t('notPublished')}</Pill> : null}
                    {set?.state === 'archived' ? <Pill tone="outline">{t('archived')}</Pill> : null}
                  </div>
                  <CardMenu
                    label={t('menu', { name })}
                    items={[
                      ...(set ? [{ key: 'open', label: t('openInLibrary'), onSelect: () => void openInLibrary(id) }] : []),
                      { key: 'remove', label: t('remove'), onSelect: () => setList(attached.filter((x) => x !== id)), destructive: true, separated: Boolean(set) },
                    ]}
                  />
                </Panel>
              )
            })}
          </ul>
          <div className="mt-4 flex flex-col items-start gap-2">
            {addButton}
            {full ? (
              <p id="faq-step-full" className="text-[0.9375rem] text-muted-foreground">
                {t('full', { max: MAX_SETS })}
              </p>
            ) : null}
          </div>

          <section aria-labelledby="faq-heading-title" className="mt-10">
            <h2 id="faq-heading-title" className="text-[1.0625rem] font-semibold text-foreground">
              {t('headingTitle')}
            </h2>
            <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('headingHelper')}</p>
            {headingLanguages.length > 1 ? (
              <SegmentedControl
                className="mt-4"
                appearance="soft"
                label={t('headingLanguage')}
                value={lang}
                onChange={setLang}
                options={headingLanguages.map((l) => ({ value: l, label: languageName(l, ui) }))}
              />
            ) : null}
            <Field className="mt-4" label={t('titleLabel')} hint={t('titleHint')}>
              {(p) => (
                <TextInput
                  {...p}
                  lang={lang}
                  value={draft.faqTitle?.[lang] ?? ''}
                  maxLength={TITLE_MAX}
                  placeholder={getFaqMessages(lang).defaultHeading}
                  onChange={(e) => update({ [`faqTitle.${lang}`]: e.target.value })}
                />
              )}
            </Field>
            <Field className="mt-4" label={t('subtitleLabel')} hint={t('subtitleHint')}>
              {(p) => (
                <TextArea
                  {...p}
                  lang={lang}
                  rows={3}
                  value={draft.faqSubtitle?.[lang] ?? ''}
                  maxLength={SUBTITLE_MAX}
                  onChange={(e) => update({ [`faqSubtitle.${lang}`]: e.target.value })}
                />
              )}
            </Field>
          </section>
        </>
      )}

      <FaqPickSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        site={site}
        postTitle={draft.title[d]?.trim() ?? ''}
        attached={attached}
        onAttach={(id) => {
          if (!attached.includes(id) && attached.length < MAX_SETS) setList([...attached, id])
        }}
        onSetChange={upsertFaqSet}
      />
    </section>
  )
}
