'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, IconButton } from './Button'
import { mergePickedFiles, type PickProblem } from './pick-files'

/**
 * Pick a few images (screenshots, photos from the camera roll) and show them
 * as thumbnails with a remove button. Controlled: the parent owns the File[]
 * and reads it when it sends. Files that do not fit (wrong type, too big, too
 * many, over the total) are left out and named in a short message under the
 * thumbnails — nothing is silently dropped.
 *
 *   <AttachmentPicker files={files} onChange={setFiles} max={3} maxBytes={5 * 1024 * 1024}
 *     labels={{ add: t('add'), hint: t('hint'), remove: (n) => t('remove', { name: n }), problem: (p) => t(`problem.${p.kind}`, { name: p.name }) }} />
 *
 * All text arrives through `labels` (already translated). The input opens the
 * phone's photo library / camera; PNG, JPG and WebP by default.
 */
export const DEFAULT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type AttachmentPickerLabels = {
  /** The add button, e.g. "Add screenshots". */
  add: string
  /** A line under the button, e.g. "Up to 3 images, 5 MB each". Optional. */
  hint?: string
  /** Accessible name of a thumbnail's remove button. */
  remove: (fileName: string) => string
  /** One sentence for a file that was left out. */
  problem: (problem: PickProblem) => string
}

export function AttachmentPicker({
  files,
  onChange,
  max,
  maxBytes,
  totalBytesMax,
  accept = DEFAULT_IMAGE_TYPES,
  labels,
  disabled = false,
}: {
  files: File[]
  onChange: (files: File[]) => void
  max: number
  maxBytes: number
  totalBytesMax?: number
  accept?: readonly string[]
  labels: AttachmentPickerLabels
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const [problems, setProblems] = useState<PickProblem[]>([])
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  function onPick(list: FileList | null) {
    const picked = Array.from(list ?? [])
    if (inputRef.current) inputRef.current.value = ''
    if (!picked.length) return
    const merged = mergePickedFiles(files, picked, { max, maxBytes, accept, totalBytesMax })
    setProblems(merged.problems)
    if (merged.files.length !== files.length) onChange(merged.files)
  }

  const full = files.length >= max
  return (
    <div className="flex flex-col items-start gap-3">
      {files.length > 0 ? (
        <ul className="flex flex-wrap items-start gap-3">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="relative size-24 overflow-hidden rounded-xl border border-border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a picked file */}
              <img src={urls[i]} alt="" className="size-full object-cover" />
              <IconButton
                appearance="chip"
                aria-label={labels.remove(f.name)}
                disabled={disabled}
                className="absolute top-1 right-1"
                onClick={() => {
                  setProblems([])
                  onChange(files.filter((_, n) => n !== i))
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        multiple={max > 1}
        hidden
        tabIndex={-1}
        onChange={(e) => onPick(e.target.files)}
      />
      <Button variant="secondary" disabled={disabled || full} onClick={() => inputRef.current?.click()} aria-describedby={labels.hint ? hintId : undefined}>
        {labels.add}
      </Button>
      {labels.hint ? (
        <p id={hintId} className="text-sm leading-5 text-muted-foreground">
          {labels.hint}
        </p>
      ) : null}
      {problems.length > 0 ? (
        <ul role="alert" className="space-y-1 text-sm leading-5 text-destructive">
          {problems.map((p, i) => (
            <li key={`${p.kind}-${p.name}-${i}`}>{labels.problem(p)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
