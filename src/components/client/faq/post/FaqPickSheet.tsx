'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { SiteFaqSet, SiteInfo } from '@/components/client/create/types'
import type { FaqSetSnapshot } from '@/lib/api/faq-sets'
import { createFaqSetAction } from '@/app/[locale]/(client)/[tenant]/faq-sets/actions'
import { FaqSetEditor } from '@/components/client/faq/FaqSetEditor'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { Panel } from '@/components/app/ui/Panel'
import { Pill } from '@/components/app/ui/list/cells'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { TextInput } from '@/components/app/ui/TextInput'
import { filterFaqSetsForPick } from './faq-pick-model'

/** Mirrors FAQ_LIMITS.name in faq-sets.ts (server code); the server re-checks. */
const NAME_MAX = 120
const CREATE_ERRORS = ['forbidden', 'too_large', 'invalid_value', 'unauthenticated', 'failed']

type Mode = 'existing' | 'new'

/**
 * "Add FAQs" (ADR-037 D9) — the post editor's sheet with two ways to attach a
 * FAQ set:
 *   • Choose existing: search the library (set names and their first
 *     questions), a preview of each set's questions; sets already on this post
 *     are shown as added, archived sets are not offered.
 *   • Create new (faq.set.write): the name defaults to the post title; the set
 *     is created as a draft, attached to the post at once, and edited right
 *     here with the library's own editor (FaqSetEditor, embedded mode).
 * Attaching goes through the post's autosave (`faqSets`), which re-checks the
 * set on the server.
 */
export function FaqPickSheet({
  open,
  onClose,
  site,
  postTitle,
  attached,
  onAttach,
  onSetChange,
}: {
  open: boolean
  onClose: () => void
  site: SiteInfo
  /** The post's title in the main language: the default name of a new set. */
  postTitle: string
  attached: readonly string[]
  onAttach: (id: string) => void
  /** A set created or changed here, so the post editor shows its name and question count. */
  onSetChange?: (set: SiteFaqSet) => void
}) {
  const t = useTranslations('clientDashboard.faq.post.sheet')
  const canCreate = Boolean(site.faqWrite)
  const [mode, setMode] = useState<Mode>('existing')
  const [query, setQuery] = useState('')
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<FaqSetSnapshot | null>(null)
  const current: Mode = canCreate ? mode : 'existing'
  const nameValue = name ?? postTitle
  const sets = filterFaqSetsForPick(site.faqSets ?? [], query)

  function close() {
    setEditing(null)
    setName(null)
    setError(null)
    setQuery('')
    setMode('existing')
    onClose()
  }

  function choose(id: string) {
    onAttach(id)
    close()
  }

  async function create() {
    const trimmed = nameValue.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await createFaqSetAction({ projectSlug: site.projectSlug, name: trimmed.slice(0, NAME_MAX) })
      if (!r.ok) {
        setError(t(`errors.${CREATE_ERRORS.includes(r.error) ? r.error : 'failed'}`))
        return
      }
      // The new set is this post's: attached straight away (a weak reference until it is published).
      onSetChange?.({ id: r.id, name: trimmed, count: 0, state: 'draft', firstQuestions: [] })
      onAttach(r.id)
      setEditing({
        id: r.id,
        rev: r.rev,
        hasDraft: true,
        isPublished: false,
        archivedAt: null,
        state: 'draft',
        name: trimmed,
        note: '',
        title: {},
        items: [],
        live: null,
        usedIn: [],
        site: { defaultLocale: site.defaultLocale, languages: site.languages },
      })
    } catch {
      setError(t('errors.failed'))
    } finally {
      setBusy(false)
    }
  }

  /** The embedded editor's Done (everything saved): keep the post editor's name / count / preview in step. */
  function onSaved(set: SiteFaqSet) {
    onSetChange?.({ ...set, name: set.name || editing?.name || '' })
  }

  return (
    <BottomSheet open={open} title={editing ? t('editTitle') : t('title')} onClose={close} size="lg">
      {editing ? (
        <div className="flex flex-col gap-4">
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('createdHelp')}</p>
          {/* Its own Done saves everything, then calls onSaved and onClose. */}
          <FaqSetEditor projectSlug={site.projectSlug} initial={editing} mode="embedded" canWrite={canCreate} onSaved={onSaved} onClose={close} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {canCreate ? (
            <SegmentedControl
              label={t('modeLabel')}
              value={current}
              onChange={setMode}
              options={[
                { value: 'existing', label: t('existing') },
                { value: 'new', label: t('new') },
              ]}
            />
          ) : null}

          {current === 'existing' ? (
            <>
              <TextInput
                type="search"
                aria-label={t('search')}
                placeholder={t('searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {sets.length === 0 ? (
                <EmptyState
                  compact
                  title={query.trim() ? t('noResults') : t('emptyTitle')}
                  body={query.trim() ? undefined : canCreate ? t('emptyBodyCreate') : t('emptyBody')}
                />
              ) : (
                <ul className="flex flex-col gap-3" aria-label={t('listLabel')}>
                  {sets.map((s) => {
                    const added = attached.includes(s.id)
                    return (
                      <Panel as="li" key={s.id} className="flex items-start gap-3">
                        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                          <span className="text-[1rem] font-medium text-foreground">{s.name}</span>
                          <span className="text-[0.9375rem] text-muted-foreground">{t('questions', { count: s.count })}</span>
                          {s.state === 'draft' ? <Pill tone="highlight">{t('notPublished')}</Pill> : null}
                          {s.firstQuestions.length ? (
                            <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem] leading-6 text-foreground" aria-label={t('previewLabel', { name: s.name })}>
                              {s.firstQuestions.map((q, i) => (
                                <li key={i} className="line-clamp-2">
                                  {q}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <Button
                          variant={added ? 'quiet' : 'secondary'}
                          disabled={added}
                          onClick={() => choose(s.id)}
                          aria-label={added ? t('addedLabel', { name: s.name }) : t('addLabel', { name: s.name })}
                        >
                          {added ? t('added') : t('add')}
                        </Button>
                      </Panel>
                    )
                  })}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('newHelp')}</p>
              <Field label={t('nameLabel')} hint={t('nameHint')} error={error ?? undefined}>
                {(p) => (
                  <TextInput
                    {...p}
                    value={nameValue}
                    maxLength={NAME_MAX}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void create()
                      }
                    }}
                  />
                )}
              </Field>
              <div className="flex flex-col items-start gap-2">
                <Button variant="primary" onClick={() => void create()} disabled={busy || !nameValue.trim()} aria-describedby={!nameValue.trim() ? 'faq-new-needs-name' : undefined}>
                  {busy ? t('creating') : t('create')}
                </Button>
                {!nameValue.trim() ? (
                  <p id="faq-new-needs-name" className="text-[0.9375rem] text-muted-foreground">
                    {t('needsName')}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
