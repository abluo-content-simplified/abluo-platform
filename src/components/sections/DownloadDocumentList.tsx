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
        {shown.map((d) => (
          <li key={d.id} className="py-5" style={{ borderColor: border }}>
            <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              <span className="break-words">{d.title}</span>
              {d.members && <span className="ml-2 inline-block align-middle" style={{ color: 'var(--color-text-secondary)' }}><LockIcon label={labels.lock} /></span>}
            </p>
            {d.note && <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{d.note}</p>}
            {d.tags.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {d.tags.map((tag) => (
                  <li key={tag} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ borderColor: border, color: 'var(--color-text-secondary)' }}>{tag}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-1 flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-4" data-document-footer>
              <p className="text-sm" style={{ color: 'var(--color-text-muted, var(--color-text-secondary))' }} data-document-meta>{meta[d.id]}</p>
              <div className="-mr-3 flex items-center self-end text-sm font-medium" data-document-actions>
                <a href={d.href} target="_blank" rel="noopener" style={{ color: 'var(--color-text-primary)' }} className="inline-flex min-h-11 items-center px-3 underline-offset-4 hover:underline">
                  {labels.view}
                </a>
                <a href={`${d.href}?download=1`} rel="nofollow" style={{ color: 'var(--color-brand-primary, var(--color-text-primary))' }} className="inline-flex min-h-11 items-center px-3 underline-offset-4 hover:underline">
                  {labels.download}
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
