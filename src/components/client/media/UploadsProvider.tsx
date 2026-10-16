'use client'

/**
 * One upload store per dashboard (ADR-035 slice 2): mounted in the client
 * and admin layouts, so photos keep uploading and optimising while the
 * person moves to another screen. Also:
 *   - warns before the tab is closed while a photo is still only in this tab;
 *   - says so when photos finished after their screen was left
 *     ("… added to your Media Library").
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Toast } from '@/components/app/ui/Toast'
import { mediaApi } from '@/components/client/media/media-api'
import { prepareForUpload } from '@/lib/client/gallery-upload-queue'
import { UploadStore, type UploadApi } from '@/lib/client/upload-store'

const UploadsContext = createContext<UploadStore | null>(null)

const api: UploadApi = {
  upload: (scope, form) => mediaApi(scope).upload(form),
  status: (scope, input) => mediaApi(scope).status(input),
}

export function createUploadStore(): UploadStore {
  return new UploadStore({
    api,
    prepare: prepareForUpload,
    createPreview: (file) => {
      try {
        return URL.createObjectURL(file)
      } catch {
        return undefined
      }
    },
    revokePreview: (url) => URL.revokeObjectURL(url),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  })
}

/** The layout's store; null outside a provider (callers then keep their own). */
export function useUploadStore(): UploadStore | null {
  return useContext(UploadsContext)
}

export function UploadsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createUploadStore)
  useEffect(() => () => store.dispose(), [store])
  return (
    <UploadsContext.Provider value={store}>
      {children}
      <UploadsNotices store={store} />
    </UploadsContext.Provider>
  )
}

function UploadsNotices({ store }: { store: UploadStore }) {
  const t = useTranslations('clientDashboard.media.uploads')
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const landed = useSyncExternalStore(store.subscribe, store.getOrphanLanded, store.getOrphanLanded)

  // Leaving the screen is fine; closing the tab before the bytes are sent is not.
  const unsent = items.some((i) => i.status === 'waiting' || i.status === 'preparing' || i.status === 'uploading')
  useEffect(() => {
    if (!unsent) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsent])

  // Photos still going whose screen is gone.
  const away = items.filter((i) => i.status !== 'done' && i.status !== 'error' && !store.hasListener(store.ownerOf(i.id) ?? '')).length

  useEffect(() => {
    if (!landed || away) return
    const id = setTimeout(() => store.clearOrphanLanded(), 5000)
    return () => clearTimeout(id)
  }, [landed, away, store])

  const message = away ? t('stillUploading', { count: away }) : landed ? t('addedToLibrary', { count: landed }) : null
  return <Toast message={message} />
}
