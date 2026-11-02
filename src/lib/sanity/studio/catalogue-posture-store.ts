// ── Catalogue Studio posture — the store and its loader (C9 §9.3 layer 4) ────
//
// The store starts CLOSED (`loaded: false` ⇒ every Catalogue document
// read-only) and only a successful posture fetch can open it. A non-200, a
// network error, a malformed body or an unreachable endpoint (a hosted
// sanity.studio copy, or R1 — where the break-glass endpoint does not exist
// yet) all FAIL CLOSED.
//
// R1 ships the store and the loader; the polling layout
// (`CataloguePostureLayout`: every 30 s, on focus, at the earliest expiry,
// plus the banner) ships with break-glass (062 + routes), because until then
// there is nothing to load and polling a missing endpoint would only add 404s.

import { CLOSED_POSTURE, type BreakGlassGrant, type PostureState } from './catalogue-posture'

/** Same origin; Supabase cookie, abluo_admin + aal2 (C9 §9.4). */
export const POSTURE_ENDPOINT = '/api/admin/studio/break-glass'

type Listener = (s: PostureState) => void

let current: PostureState = CLOSED_POSTURE
const listeners = new Set<Listener>()

export const postureStore = {
  get: (): PostureState => current,
  set(next: PostureState) {
    current = next
    for (const l of listeners) l(current)
  },
  subscribe(l: Listener): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  /** Tests only. */
  reset() {
    current = CLOSED_POSTURE
    listeners.clear()
  },
}

const isGrant = (g: unknown): g is BreakGlassGrant => {
  const x = g as Record<string, unknown> | null
  return !!x && typeof x.id === 'string' && typeof x.projectSlug === 'string' && typeof x.expiresAt === 'string' && !Number.isNaN(Date.parse(x.expiresAt)) && x.enabledBy === 'abluo-admin'
}

type FetchLike = (url: string, init?: { credentials?: 'same-origin'; cache?: 'no-store' }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** Fetches the posture and writes it to the store. Never throws; anything but a well-formed 200 closes the posture. */
export async function loadCataloguePosture(fetchFn: FetchLike, store: Pick<typeof postureStore, 'set'> = postureStore): Promise<PostureState> {
  let next: PostureState = CLOSED_POSTURE
  try {
    const res = await fetchFn(POSTURE_ENDPOINT, { credentials: 'same-origin', cache: 'no-store' })
    if (res.ok && res.status === 200) {
      const body = (await res.json()) as { grants?: unknown } | null
      if (body && Array.isArray(body.grants) && body.grants.every(isGrant)) next = { grants: body.grants, loaded: true }
    }
  } catch {
    next = CLOSED_POSTURE
  }
  store.set(next)
  return next
}
