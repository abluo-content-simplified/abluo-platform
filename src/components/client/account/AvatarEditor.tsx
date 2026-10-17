'use client'

import { useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Avatar } from '@/components/app/ui/Avatar'
import { AVATAR_EDGE_PX } from '@/lib/account/avatar'
import { removeAvatarAction, uploadAvatarAction } from '@/app/[locale]/(client)/account/actions'
import { Button } from '@/components/app/ui/Button'

/**
 * The person's own photo on the Account page (Tom, 2026-10-08): change or
 * remove it. The browser crops the chosen picture to a centred square and
 * resizes it to 512px JPEG before upload, so phone photos stay small; the
 * server re-checks the real file type and size.
 */
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const edge = Math.min(AVATAR_EDGE_PX, side)
  const canvas = document.createElement('canvas')
  canvas.width = edge
  canvas.height = edge
  const g = canvas.getContext('2d')
  if (!g) throw new Error('no canvas')
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge)
  bitmap.close()
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.88),
  )
}

export function AvatarEditor({ name, email, src }: { name: string; email: string; src: string | null }) {
  const t = useTranslations('account.avatar')
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function onPick(file: File | undefined) {
    if (!file) return
    setError(null)
    start(async () => {
      try {
        const blob = await toSquareJpeg(file)
        const fd = new FormData()
        fd.append('file', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
        const r = await uploadAvatarAction(fd)
        if (!r.ok) setError(t(`errors.${r.error}`))
        else router.refresh()
      } catch {
        setError(t('errors.type'))
      } finally {
        if (input.current) input.current.value = ''
      }
    })
  }

  function onRemove() {
    setError(null)
    start(async () => {
      const r = await removeAvatarAction()
      if (!r.ok) setError(t(`errors.${r.error}`))
      else router.refresh()
    })
  }


  return (
    <div className="flex items-center gap-4 py-2">
      <Avatar name={name} email={email} src={src} size="lg" />
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => input.current?.click()}>
            {pending ? t('saving') : src ? t('change') : t('add')}
          </Button>
          {src ? (
            <Button disabled={pending} onClick={onRemove}>
              {t('remove')}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </div>
    </div>
  )
}
