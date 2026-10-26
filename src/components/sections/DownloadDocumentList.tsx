'use client'

import { useState } from 'react'
import type { DownloadSectionDocument } from '@/lib/sanity/types'

// ── Download section: the list, with a category filter (ADR-040 §15, R9.2) ────
// Client only for the filter: the documents arrive already chosen and checked
// for this visitor (hydrateDownloadSections). The filter shows when the list
// holds documents of two or more categories; "All" is always first. Text comes
// from the caller (website messages), so this component carries none.

type Labels = {
  view: string
  download: string
  lock: string
  all: string
  filter: string
}

function FileIcon({ image }: { image: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {image
        ? <path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01" />
        : <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6" />}
    </svg>
  )
}

function LockIcon({ label }: { label: string }) {
  return (
    <svg role="img" aria-label={label} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <title>{label}</title>
      <path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z" />
    </svg>
  )
}

export function DownloadDocumentList({ documents, meta, labels }: { documents: DownloadSectionDocument[]; meta: Record<string, string>; labels: Labels }) {
  const categories: Array<{ key: string; label: string }> = []
  for (const d of documents) if (d.category && !categories.some((c) => c.key === d.category!.key)) categories.push(d.category)
  const [active, setActive] = useState<string | null>(null)
  const shown = active ? documents.filter((d) => d.category?.key === active) : documents
  const border = 'var(--color-border, rgba(0,0,0,0.08))'

  return (
    <>
      {categories.length > 1 ? (
        <div role="group" aria-label={labels.filter} className="mb-6 flex flex-wrap gap-2">
          {[{ key: null as string | null, label: labels.all }, ...categories].map((c) => {
            const on = active === c.key
            return (
              <button
                key={c.key ?? '*'}
                type="button"
                aria-pressed={on}
                onClick={() => setActive(c.key)}
                className="rounded-full border px-4 py-1.5 text-sm font-medium transition-colors"
                style={{
                  borderColor: on ? 'var(--color-text-primary)' : border,
                  background: on ? 'var(--color-text-primary)' : 'transparent',
                  color: on ? 'var(--color-background, #fff)' : 'var(--color-text-primary)',
                }}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      ) : null}
      <ul className="divide-y" style={{ borderColor: border }} data-documents>
        {shown.map((d) => {
          const isImage = d.file.mimeType.startsWith('image/')
          return (
            <li key={d.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 py-5" style={{ borderColor: border }}>
              <span className="mt-0.5 shrink-0" style={{ color: 'var(--color-text-secondary)' }}><FileIcon image={isImage} /></span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  <span className="min-w-0 break-words">{d.title}</span>
                  {d.members && <span className="shrink-0" style={{ color: 'var(--color-text-secondary)' }}><LockIcon label={labels.lock} /></span>}
                </p>
                {d.note && <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{d.note}</p>}
                <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted, var(--color-text-secondary))' }}>{meta[d.id]}</p>
                {d.tags.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {d.tags.map((tag) => (
                      <li key={tag} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ borderColor: border, color: 'var(--color-text-secondary)' }}>{tag}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-4 text-sm font-medium">
                <a href={d.href} target="_blank" rel="noopener" style={{ color: 'var(--color-text-primary)' }} className="underline-offset-4 hover:underline">
                  {labels.view}
                </a>
                <a href={`${d.href}?download=1`} rel="nofollow" style={{ color: 'var(--color-brand-primary, var(--color-text-primary))' }} className="underline-offset-4 hover:underline">
                  {labels.download}
                </a>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
