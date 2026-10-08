'use client'

import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { WizardFrame } from '@/components/client/create/WizardFrame'
import { PhotoAddStep, type AddedPhoto } from '@/components/client/gallery/wizard/PhotoAddStep'
import { PhotoDescribeStep, type DescribeChange, type DescribedPhoto } from '@/components/client/gallery/wizard/PhotoDescribeStep'
import { DoneScreen } from '@/components/client/gallery/wizard/kit'
import { clampIndex, firstUndescribed } from '@/lib/client/gallery-wizard'
import type { MediaLibraryScope } from '@/components/client/media/media-api'

type Step = 'add' | 'describe' | 'done'
type Photo = DescribedPhoto & { thumbUrl: string | null }

/**
 * "Add to media library" as a wizard in the blog wizard's frame (v1.0.45):
 * Add photos (the gallery's Add photos step, without "Media Library"; 2+
 * at once → "Name and tag all") → Describe photo n of N (the one photo card,
 * saved on each asset) → Done → back to the Media page. Uploads land in the
 * library at once, so the × before the first photo leaves nothing behind and
 * "Save & exit" after it only waits for the texts being saved. Descriptions
 * are never required (Tom, wave B): Next, Done and "Describe later" go on.
 */
export function MediaAddWizard({
  projectSlug,
  scope = 'media',
  site,
  mediaHref,
}: {
  projectSlug: string
  /** Which actions upload and save: the client's Media Library (default) or the admin's. */
  scope?: MediaLibraryScope
  site: { defaultLocale: string; locales: string[] }
  mediaHref: string
}) {
  const t = useTranslations('clientDashboard.photoWizard.media')
  const tc = useTranslations('clientDashboard.create')
  const router = useRouter()
  const d = site.defaultLocale
  const [step, setStep] = useState<Step>('add')
  const [photos, setPhotos] = useState<Photo[]>([])
  const photosRef = useRef<Photo[]>([])
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)
  const saves = useRef<Promise<unknown>>(Promise.resolve())

  const setAll = (next: Photo[]) => {
    photosRef.current = next
    setPhotos(next)
  }
  /** Each finished upload appends to the LATEST list. */
  const onAdd = (added: AddedPhoto[]) =>
    setAll([
      ...photosRef.current,
      ...added.map((p) => ({
        key: p.assetId,
        assetId: p.assetId,
        rev: '',
        url: p.url,
        thumbUrl: p.thumbUrl,
        name: p.name ?? '',
        alt: p.alt,
        caption: {},
        tags: p.tags ?? [],
        focal: p.focal,
      })),
    ])
  const onChange = useCallback((c: DescribeChange) => {
    const next = photosRef.current.map((p) => (p.assetId === c.assetId ? merge(p, c) : p))
    photosRef.current = next
    setPhotos(next)
  }, [])
  /** "Name and tag all" saved: new names, tags and revisions. */
  const onPhotosChanged = (changes: DescribeChange[]) => {
    const by = new Map(changes.map((c) => [c.assetId, c]))
    setAll(photosRef.current.map((p) => (by.has(p.assetId) ? merge(p, by.get(p.assetId)!) : p)))
  }
  const onSaving = useCallback((job: Promise<unknown>) => {
    saves.current = Promise.all([saves.current, job.catch(() => undefined)])
  }, [])

  const index = clampIndex(at, photos.length)
  const current = photos.length ? photos[index] : null
  const top = () => mainRef.current?.scrollTo?.({ top: 0 })

  const leave = async () => {
    await saves.current
    router.push(mediaHref)
  }
  /** Done (or "Describe later"): wait for the texts being saved, then the Done screen. */
  const finish = async () => {
    setBusy(true)
    await saves.current
    setBusy(false)
    setStep('done')
    top()
  }
  const goNext = async () => {
    if (step === 'add') {
      setAt(Math.max(0, firstUndescribed(photos, d)))
      setStep('describe')
      return top()
    }
    if (index < photos.length - 1) {
      setAt(index + 1)
      return top()
    }
    await finish()
  }
  const goBack = () => {
    if (step === 'describe' && index > 0) return setAt(index - 1)
    if (step === 'describe') setStep('add')
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (e.defaultPrevented || target.closest('dialog')) return
    if (e.key === 'Escape' && step !== 'done') {
      e.preventDefault()
      void leave()
    }
  }

  const last = step === 'describe' && index === photos.length - 1
  return (
    <WizardFrame
      onKeyDown={onKeyDown}
      mainRef={mainRef}
      exit={step === 'done' ? null : photos.length ? { kind: 'save', onPress: () => void leave() } : { kind: 'close', onPress: () => router.push(mediaHref) }}
      saveState={busy ? 'saving' : 'idle'}
      onReload={() => window.location.reload()}
      footer={
        step === 'done'
          ? null
          : {
              progress: { current: step === 'add' ? 1 : 2, total: 2 },
              back: step === 'describe' ? { onPress: goBack, disabled: busy } : null,
              primary: {
                label: last ? tc('shell.done') : tc('shell.next'),
                onPress: () => void goNext(),
                disabled: busy || photos.length === 0,
                busy,
              },
            }
      }
    >
      {/* Add photos stays mounted so uploads keep going while you describe. */}
      <div hidden={step !== 'add'}>
        <PhotoAddStep
          projectSlug={projectSlug}
          scope={scope}
          title={t('addTitle')}
          helper={t('addHelper')}
          defaultLocale={d}
          items={photos}
          onAdd={onAdd}
          onPhotosChanged={onPhotosChanged}
          onOpen={(key) => {
            setAt(Math.max(0, photosRef.current.findIndex((p) => p.key === key)))
            setStep('describe')
            top()
          }}
          library={false}
        />
      </div>
      {step === 'describe' && current ? (
        <PhotoDescribeStep
          key={current.key}
          projectSlug={projectSlug}
          scope={scope}
          site={{ defaultLocale: d, languages: site.locales }}
          photo={current}
          index={index}
          total={photos.length}
          onChange={onChange}
          onSaving={onSaving}
          onSkip={() => void finish()}
        />
      ) : step === 'done' ? (
        <DoneScreen heading={t('doneTitle')} body={t('doneBody', { count: photos.length })} backHref={mediaHref} backLabel={t('back')} />
      ) : null}
    </WizardFrame>
  )
}

/** A change from the card or the batch sheet, onto the wizard's copy of the photo. */
function merge(p: Photo, c: DescribeChange): Photo {
  return {
    ...p,
    rev: c.rev ?? p.rev,
    name: c.name ?? p.name,
    alt: c.alt ?? p.alt,
    caption: c.caption ?? p.caption,
    tags: c.tags ?? p.tags,
    focal: c.focal === undefined ? p.focal : c.focal,
  }
}
