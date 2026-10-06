'use client'

/**
 * The gallery wizard's steps (Tom, gallery redo). Dumb like the blog steps:
 * they render one question and report changes; GalleryWizard owns autosave,
 * navigation and saving. Each is a copy of the matching blog step's layout
 * (v1.0.45), built from ./wizard/kit (copies of the blog's pieces).
 */
import type { GalleryStatus } from '@/lib/api/gallery-status'
import { GalleryStatusLines } from './GalleryStatusLines'
import { useCallback, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { TagEditor } from '@/components/client/media/PhotoCard'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { mintGalleryPreviewAction } from '@/app/[locale]/(client)/[tenant]/galleries/preview-actions'
import type { GalleryUsage } from '@/lib/api/gallery-drafts'
import type { DraftPreviewLink } from '@/lib/api/post-preview'
import { draftPreviewUrl } from '@/lib/client/preview-url'
import { galleryLanguageReady, gallerySections, photoNeedsAlt, type GallerySection } from '@/lib/client/gallery-wizard'
import { DoneScreen, LanguageOption, NameFields, OverviewMenu, PreviewPane, Segmented, StateBadge, type LanguageChoice } from './wizard/kit'

/** Limits mirror GALLERY_LIMITS (server module). */
export const GALLERY_TITLE_MAX = 120
export const GALLERY_DESCRIPTION_MAX = 300

export type GalleryTexts = { title: Record<string, string>; description: Record<string, string> }
export type GallerySite = { projectSlug: string; defaultLocale: string; languages: string[] }
type Photo = { key: string; alt: Record<string, string>; missing?: boolean; thumbUrl: string | null }

// ── Name ─────────────────────────────────────────────────────────────────────

/** "Name your gallery" — title (required) and description, in the site's main language. */
export function NameStep({
  texts,
  locale,
  onText,
  tags,
  onTags,
}: {
  texts: GalleryTexts
  locale: string
  onText: (field: 'title' | 'description', locale: string, value: string) => void
  tags: string[]
  onTags: (tags: string[]) => void
}) {
  const t = useTranslations('clientDashboard.gallery.wizard.name')
  const tl = useTranslations('clientDashboard.gallery.list')
  return (
    <section aria-labelledby="gallery-name-title">
      <StepHeading id="gallery-name-title" title={t('title')} helper={t('helper')} />
      <NameFields
        idPrefix="gallery-name"
        lang={locale}
        title={texts.title[locale] ?? ''}
        description={texts.description[locale] ?? ''}
        onTitle={(v) => onText('title', locale, v)}
        onDescription={(v) => onText('description', locale, v)}
        labels={{ title: t('titleLabel'), description: t('descriptionLabel') }}
        placeholders={{ title: t('titlePlaceholder'), description: t('descriptionPlaceholder') }}
        max={{ title: GALLERY_TITLE_MAX, description: GALLERY_DESCRIPTION_MAX }}
        autoFocus
      />
      <div className="mt-6">
        <TagEditor
          id="gallery-name-tags"
          tags={tags}
          suggestions={[]}
          labels={{
            label: tl('tags.label'),
            helper: tl('tags.helper'),
            placeholder: tl('tags.placeholder'),
            add: tl('tags.add'),
            remove: (tag) => tl('tags.remove', { tag }),
            suggested: tl('tags.suggested'),
            full: tl('tags.full', { max: 10 }),
          }}
          onChange={onTags}
        />
      </div>
    </section>
  )
}

// ── Languages ────────────────────────────────────────────────────────────────

/**
 * "Make it available in other languages?" — the blog's languages step for a
 * gallery: the same three answers per language; "I'll write it" shows the
 * title and description for that language next to the original.
 */
export function GalleryLanguagesStep({
  texts,
  site,
  choices,
  active,
  onChoice,
  onActive,
  onText,
}: {
  texts: GalleryTexts
  site: GallerySite
  choices: Record<string, LanguageChoice>
  active: string | null
  onChoice: (locale: string, choice: LanguageChoice) => void
  onActive: (locale: string) => void
  onText: (field: 'title' | 'description', locale: string, value: string) => void
}) {
  const t = useTranslations('clientDashboard.create.languages')
  const tg = useTranslations('clientDashboard.gallery.wizard')
  const ui = useLocale()
  const d = site.defaultLocale
  const others = site.languages.filter((l) => l !== d)
  const writing = others.filter((l) => choices[l] === 'write')
  const current = active && writing.includes(active) ? active : (writing[0] ?? null)

  return (
    <section aria-labelledby="gallery-languages-title">
      <StepHeading id="gallery-languages-title" title={t('title')} helper={tg('languages.helper')} />

      <ul className="mt-8 flex flex-col gap-3">
        <li className="flex min-h-14 items-center justify-between rounded-2xl border border-border-subtle bg-muted px-4 py-3">
          <span className="text-[1.0625rem] font-medium text-foreground">{languageName(d, ui)}</span>
          <span className="text-sm text-muted-foreground">{t('original')}</span>
        </li>
        {others.map((locale) => {
          const choice = choices[locale] ?? 'later'
          const name = languageName(locale, ui)
          const ready = galleryLanguageReady(texts, locale)
          return (
            <li key={locale} className="rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[1.0625rem] font-medium text-foreground">{name}</span>
                <span className={`text-sm ${ready ? 'text-success' : 'text-muted-foreground'}`}>{ready ? t('ready') : t('missing')}</span>
              </div>
              <div role="radiogroup" aria-label={name} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <LanguageOption on={false} disabled label={t('translate')} badge={t('soon')} />
                <LanguageOption
                  on={choice === 'write'}
                  label={t('write')}
                  onPress={() => {
                    onChoice(locale, 'write')
                    onActive(locale)
                  }}
                />
                <LanguageOption on={choice === 'later'} label={t('later')} onPress={() => onChoice(locale, 'later')} />
              </div>
            </li>
          )
        })}
      </ul>

      {current ? (
        <div className="mt-10 border-t border-border-subtle pt-8">
          {writing.length > 1 ? (
            <div role="radiogroup" aria-label={t('write')} className="mb-6 flex flex-wrap gap-2">
              {writing.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={l === current}
                  onClick={() => onActive(l)}
                  className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 text-[0.9375rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    l === current ? 'border-foreground bg-selected-tint text-foreground' : 'border-border text-foreground hover:bg-hover'
                  }`}
                >
                  {languageName(l, ui)}
                </button>
              ))}
            </div>
          ) : null}
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{t('editing', { language: languageName(current, ui) })}</h2>
          <div key={current}>
            <NameFields
              idPrefix={`gallery-lang-${current}`}
              lang={current}
              title={texts.title[current] ?? ''}
              description={texts.description[current] ?? ''}
              onTitle={(v) => onText('title', current, v)}
              onDescription={(v) => onText('description', current, v)}
              labels={{ title: tg('name.titleLabel'), description: tg('name.descriptionLabel') }}
              placeholders={{
                title: t('titlePlaceholder', { language: languageName(current, ui) }),
                description: tg('languages.descriptionPlaceholder', { language: languageName(current, ui) }),
              }}
              max={{ title: GALLERY_TITLE_MAX, description: GALLERY_DESCRIPTION_MAX }}
              source={{
                label: t('sourceLabel', { language: languageName(d, ui) }),
                lang: d,
                title: texts.title[d] ?? '',
                description: texts.description[d] ?? '',
                empty: t('sourceEmpty'),
              }}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

// ── Preview ──────────────────────────────────────────────────────────────────

/**
 * "Here's how your gallery will look" — the blog's preview frame, on the
 * gallery draft (preview kind "gallery"): on a page that shows it, or the
 * gallery alone in the website's design.
 */
export function GalleryPreviewStep({
  site,
  galleryId,
  texts,
  pages,
  pageId,
  onPage,
  flush,
}: {
  site: GallerySite
  galleryId: string
  texts: GalleryTexts
  pages: GalleryUsage[]
  pageId: string | null
  onPage: (id: string | null) => void
  flush: () => Promise<unknown>
}) {
  const t = useTranslations('clientDashboard.gallery.wizard.preview')
  const tp = useTranslations('clientDashboard.gallery.preview')
  const languages = site.languages.filter((l) => l === site.defaultLocale || texts.title[l]?.trim())
  const mint = useCallback(async () => {
    // The preview reads the saved draft: make sure the last edits are saved.
    await flush()
    return mintGalleryPreviewAction({ projectSlug: site.projectSlug, id: galleryId, pageId })
  }, [flush, site.projectSlug, galleryId, pageId])
  const buildSrc = useCallback(
    (link: DraftPreviewLink, locale: string, theme: 'light' | 'dark' | null) =>
      draftPreviewUrl({ origin: link.origin, locale, projectSlug: link.projectSlug, id: galleryId, token: link.token, theme, kind: 'gallery' }),
    [galleryId]
  )
  return (
    <PreviewPane
      title={t('title')}
      helper={t('helper')}
      languages={galleryId ? languages : []}
      defaultLocale={site.defaultLocale}
      mint={mint}
      buildSrc={buildSrc}
      controls={
        pages.length > 0 ? (
          <Segmented
            label={tp('on')}
            value={pageId ?? ''}
            options={[...pages.map((p) => ({ value: p.id, label: p.title })), { value: '', label: tp('alone') }]}
            onChange={(v: string) => onPage(v || null)}
          />
        ) : null
      }
    />
  )
}

// ── Overview ("review") ──────────────────────────────────────────────────────

/**
 * The overview an existing gallery opens on: its parts, each with its state
 * and an Edit button that opens just that step ("Done" comes back here), plus
 * Preview. The wizard's main button saves.
 */
export function GalleryReviewStep({
  texts,
  items,
  site,
  onEdit,
  onPreview,
  menu,
  status,
  notice,
}: {
  texts: GalleryTexts
  items: Photo[]
  site: GallerySite
  onEdit: (section: GallerySection['id']) => void
  onPreview: () => void
  menu: { key: string; label: string; onSelect: () => void }[]
  status: GalleryStatus | null
  notice: { kind: 'status' | 'error'; text: string } | null
}) {
  const t = useTranslations('clientDashboard.gallery.wizard.review')
  const tr = useTranslations('clientDashboard.create.review')
  const tm = useTranslations('clientDashboard.create.menu')
  const ui = useLocale()
  const d = site.defaultLocale
  const described = items.filter((p) => !photoNeedsAlt(p, d)).length

  const summary = (id: GallerySection['id']): ReactNode => {
    switch (id) {
      case 'name':
        return texts.title[d]?.trim() ? (
          <>
            <span className="block font-medium text-foreground">{texts.title[d]}</span>
            {texts.description[d]?.trim() ? <span className="block">{texts.description[d]}</span> : null}
          </>
        ) : (
          t('noTitle')
        )
      case 'photos':
        return t('photos', { count: items.length })
      case 'describe':
        return !items.length ? t('noPhotos') : described === items.length ? t('allDescribed') : t('described', { done: described, total: items.length })
      case 'languages':
        return site.languages
          .filter((l) => l !== d)
          .map((l) => `${languageName(l, ui)} ${galleryLanguageReady(texts, l) ? '✓' : `– ${t('languageMissing')}`}`)
          .join(' · ')
    }
  }

  return (
    <section aria-labelledby="gallery-review-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <StepHeading id="gallery-review-title" title={texts.title[d]?.trim() || t('title')} helper={t('helper')} />
        </div>
        {menu.length > 0 ? <OverviewMenu items={menu} label={tm('label')} /> : null}
      </div>
      {status ? <GalleryStatusLines status={status} className="mt-4" /> : null}
      <p
        role={notice?.kind === 'error' ? 'alert' : 'status'}
        className={`mt-2 min-h-5 text-[0.9375rem] ${notice?.kind === 'error' ? 'text-destructive' : 'text-success'}`}
      >
        {notice?.text}
      </p>

      <ul className="mt-8 divide-y divide-border-subtle border-y border-border-subtle">
        {gallerySections({ ...texts, items }, { languages: site.languages, defaultLocale: d }).map(({ id, state }) => {
          const name = t(`sections.${id}`)
          const thumb = id === 'photos' ? items.find((p) => p.thumbUrl)?.thumbUrl : null
          return (
            <li key={id} className="flex items-start gap-4 py-5">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail
                <img src={thumb} alt="" width={56} height={56} className="size-14 shrink-0 rounded-xl object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[1.0625rem] font-semibold text-foreground">{name}</h2>
                  <StateBadge state={state} label={tr(`state.${state}`)} />
                </div>
                <p className="mt-1 line-clamp-3 text-[0.9375rem] leading-6 text-muted-foreground">{summary(id)}</p>
              </div>
              <button
                type="button"
                onClick={() => onEdit(id)}
                aria-label={tr('editLabel', { section: name })}
                className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border px-4 text-[0.9375rem] font-semibold text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {tr('edit')}
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={onPreview}
        className="mt-6 inline-flex min-h-11 items-center gap-2 text-[1.0625rem] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {tr('preview')}
      </button>
    </section>
  )
}

// ── Done ─────────────────────────────────────────────────────────────────────

/**
 * The final screen (the blog DoneStep). A new gallery: "Saved". An existing
 * one: "Updated on: <pages and posts>". Then back to the galleries.
 */
export function GalleryDoneStep({ isNew, places, listHref }: { isNew: boolean; places: string; listHref: string }) {
  const t = useTranslations('clientDashboard.gallery.wizard.done')
  return (
    <DoneScreen
      heading={isNew ? t('saved') : t('updated')}
      body={isNew ? t('savedBody') : places ? t('updatedOn', { places }) : t('updatedBody')}
      backHref={listHref}
      backLabel={t('back')}
    />
  )
}
