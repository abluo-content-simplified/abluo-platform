'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createCatalogueDocAction,
  discardCatalogueDraftAction,
  openCatalogueForEditAction,
  patchCatalogueDraftAction,
  publishCatalogueDraftAction,
} from '@/app/[locale]/(client)/[tenant]/catalogue/actions'
import { timedAction } from '@/lib/perf/client-log'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import { routePreDraft } from '@/lib/client/lazy-draft'
import type { CatalogueKind } from '@/lib/modules/catalogue/dashboard-patch'
import type { CatalogueErrorDetail } from '@/lib/modules/catalogue/dashboard-patch'
import type { Referrer } from '@/lib/lifecycle/service'

/** The first real content that creates the document (lazy creation): its name. */
export const CATALOGUE_CONTENT = /^name\./

export type PublishMode = 'now' | 'schedule' | 'keep'
export type PublishOutcome =
  | { ok: true; slugs: Record<string, string>; published: Array<{ type: string; id: string; publishedAt: string }>; notLive: Referrer[] }
  | { ok: false; error: string; detail?: CatalogueErrorDetail }

/**
 * One catalogue draft behind any editor (item wizard, item editor, collection
 * builder, option-list editor), on the shared autosave engine (ADR-025 D1/D2):
 * every change is journalled and sent in order with the latest revision.
 *
 * Lazy creation (as galleries): a new document does not exist until its
 * first name is typed — everything chosen before (a type, a category) is held
 * and sent with it; then the URL becomes the document's own without a reload.
 * A published document's first change opens its draft (an exact copy).
 */
export function useCatalogueDraft({
  projectSlug,
  kind,
  initialId,
  initialRev,
  hasDraft: initialHasDraft,
  defaultLocale,
  create,
}: {
  projectSlug: string
  kind: CatalogueKind
  /** '' for a new document (nothing created yet). */
  initialId: string
  initialRev: string
  hasDraft: boolean
  defaultLocale: string
  /** Extra fields for the create call (item profile, collection type). */
  create?: () => { itemProfile?: string; collectionType?: string }
}) {
  const idRef = useRef(initialId)
  const [id, setId] = useState(initialId)
  const hasDraftRef = useRef(initialHasDraft)
  const [hasDraft, setHasDraft] = useState(initialHasDraft)
  const heldRef = useRef<PendingSet>({})
  const sentRef = useRef(Boolean(initialId))
  const rekeyRef = useRef<(key: string) => Promise<void>>(async () => undefined)
  const createRef = useRef(create)
  const finished = useRef(false)
  const [journalKey] = useState(() => (initialId ? `catalogue:${initialId}` : `new-catalogue-${kind}:${Math.random().toString(36).slice(2)}`))
  useEffect(() => {
    createRef.current = create
  }, [create])

  const markDraft = () => {
    hasDraftRef.current = true
    setHasDraft(true)
  }

  const send = useCallback(
    async (input: { rev: string; set: PendingSet }) => {
      let rev = input.rev
      if (!idRef.current) {
        const first = input.set[`name.${defaultLocale}`]
        const extra = createRef.current?.() ?? {}
        const c = await timedAction('catalogue.create', () => createCatalogueDocAction({ projectSlug, kind, name: typeof first === 'string' ? first.trim().slice(0, 120) : undefined, ...extra }))
        if (!c.ok) return { ok: false, error: c.error === 'forbidden' || c.error === 'unauthenticated' ? c.error : 'failed' } as const
        idRef.current = c.id
        rev = c.rev
        await rekeyRef.current(`catalogue:${c.id}`)
        setId(c.id)
        markDraft()
        try {
          // /catalogue/new → /catalogue/<id> (likewise collections/new, option-lists/new).
          window.history.replaceState(window.history.state, '', window.location.pathname.replace(/\/new\/?$/, `/${c.id}`) + window.location.search)
        } catch {
          /* ignore */
        }
      } else if (!hasDraftRef.current || !rev) {
        const opened = await timedAction('catalogue.open', () => openCatalogueForEditAction({ projectSlug, kind, id: idRef.current }))
        if (!opened.ok) return { ok: false, error: opened.error } as const
        rev = opened.rev
        markDraft()
      }
      const r = await timedAction('catalogue.patch (autosave)', () => patchCatalogueDraftAction({ projectSlug, kind, id: idRef.current, rev, set: input.set }))
      return r.ok ? ({ ok: true, rev: r.rev } as const) : ({ ok: false, error: r.error } as const)
    },
    [projectSlug, kind, defaultLocale]
  )

  const autosave = useAutosave({ draftId: journalKey, rev: initialRev, send })
  useEffect(() => {
    rekeyRef.current = autosave.rekey
  }, [autosave.rekey])

  /** Every change goes through here: held until the name exists, then autosaved. */
  const update = useCallback(
    (set: PendingSet) => {
      if (finished.current) return
      if (idRef.current || sentRef.current) {
        const held = heldRef.current
        heldRef.current = {}
        autosave.set({ ...held, ...set })
        return
      }
      const routed = routePreDraft(heldRef.current, set, CATALOGUE_CONTENT)
      heldRef.current = routed.held
      if (routed.send) {
        sentRef.current = true
        autosave.set(routed.send)
      }
    },
    [autosave]
  )

  const publish = useCallback(
    async (mode: PublishMode, dates: { publishAt?: string | null; expiresAt?: string | null } = {}, opts: { keepEditing?: boolean; withDependencies?: boolean } = {}): Promise<PublishOutcome> => {
      const saved = await autosave.flush()
      if (!saved) return { ok: false, error: autosave.currentState() === 'conflict' ? 'conflict' : 'offline' }
      if (!idRef.current) return { ok: false, error: 'missing_name' }
      if (!hasDraftRef.current) {
        // Nothing changed on a published document: open its draft so "Update" still works.
        const opened = await timedAction('catalogue.open', () => openCatalogueForEditAction({ projectSlug, kind, id: idRef.current }))
        if (!opened.ok) return { ok: false, error: opened.error }
        autosave.adoptRev(opened.rev)
        markDraft()
      }
      const r = await timedAction('catalogue.publish', () => publishCatalogueDraftAction({ projectSlug, kind, id: idRef.current, rev: autosave.currentRev(), mode, ...dates, withDependencies: opts.withDependencies === true }))
      if (!r.ok) return { ok: false, error: r.error, detail: r.detail }
      // A wizard is done; an editor keeps going (its next change opens a fresh draft).
      if (!opts.keepEditing) finished.current = true
      await autosave.discard()
      hasDraftRef.current = false
      setHasDraft(false)
      return { ok: true, slugs: r.slugs, published: r.published, notLive: r.notLive }
    },
    [autosave, projectSlug, kind]
  )

  const discardChanges = useCallback(async () => {
    await autosave.flush()
    const r = await timedAction('catalogue.discard', () => discardCatalogueDraftAction({ projectSlug, kind, id: idRef.current, rev: autosave.currentRev() }))
    if (r.ok) {
      finished.current = true
      await autosave.discard()
    }
    return r
  }, [autosave, projectSlug, kind])

  return {
    id,
    created: Boolean(id),
    hasDraft,
    update,
    publish,
    discardChanges,
    flush: autosave.flush,
    state: autosave.state,
    rejected: autosave.rejected,
    retry: autosave.retry,
    reload: async () => {
      await autosave.discard()
      window.location.reload()
    },
    /** True while an edit could still be lost (used before leaving). */
    currentRev: autosave.currentRev,
  }
}
