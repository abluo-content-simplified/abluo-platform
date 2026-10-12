// ── Connections — what the consent screen shows (ours, pure over the store) ──
//
// Builds the data for `/connect/authorize` from the partner's request and the
// signed-in person's grants. The screen never decides anything: approving
// goes through `approveConnect`, which re-validates everything server-side.
//
// Two ways in, one screen (ADR-031 D2):
//   - started by the partner: it sends the person here with the OAuth request;
//   - started from Abluo (later): the Connected apps screen sends the person to
//     the partner's registered start link with the site; the partner comes back
//     here with `project=<site slug>` and that site is pre-selected.

import { can, type AuthzSubject } from '@/lib/authz/check'
import { validateAuthorizeRequest, type AuthorizeParams, type ConsentDeps } from './consent'
import { SHAREABLE_RESOURCES, type ShareableResource } from './resources'
import type { ConnectionStatus, SharedResources } from './types'

export interface ConsentField {
  name: string
  personal: boolean
  /** Ticked by default: public fields yes, personal data no. */
  checked: boolean
}

export interface ConsentResource {
  name: ShareableResource
  fields: ConsentField[]
}

export interface ConsentProject {
  projectId: string
  projectSlug: string
  name: string
  /** This app is already connected to this site (approving updates what is shared). */
  existing: ConnectionStatus | null
  /** What is shared today on that existing connection (the form starts from it). */
  shared: SharedResources | null
}

export type ConsentView =
  | { state: 'invalid'; error: string } // never redirect: unknown app or untrusted return address
  | { state: 'redirect'; redirectTo: string } // a partner error the partner must hear about
  | { state: 'support_mode'; appName: string; cancelTo: string }
  | { state: 'no_site'; appName: string; cancelTo: string }
  | {
      state: 'ready'
      appName: string
      resources: ConsentResource[]
      projects: ConsentProject[]
      preselectedProjectId: string | null
      cancelTo: string
      sandboxOnly: boolean
    }

type Subject = Omit<AuthzSubject, 'projects'> & { userId: string; projects: ReadonlyArray<{ projectId: string; projectSlug?: string; permissions: readonly string[] }> }

export async function buildConsentView(
  subject: Subject,
  params: AuthorizeParams & { project?: string | null },
  deps: ConsentDeps & { projectNames?: Readonly<Record<string, string | null | undefined>> },
): Promise<ConsentView> {
  const v = await validateAuthorizeRequest(params, deps)
  if (!v.ok) return v.redirect ? { state: 'redirect', redirectTo: v.redirectTo } : { state: 'invalid', error: v.error }

  const cancel = new URL(v.redirectUri)
  cancel.searchParams.set('error', 'access_denied')
  if (v.state) cancel.searchParams.set('state', v.state)
  const cancelTo = cancel.toString()

  if (subject.support) return { state: 'support_mode', appName: v.app.name, cancelTo }

  const sandboxOnly = /^http:\/\/localhost(:[0-9]{2,5})?(\/|$)/.test(v.redirectUri)
  const sandboxIds = deps.sandboxProjectIds ?? []
  const eligible = subject.projects.filter(
    (p) => can(subject, 'connections.manage', { kind: 'project', projectId: p.projectId }) && (!sandboxOnly || sandboxIds.includes(p.projectId)),
  )
  if (eligible.length === 0) return { state: 'no_site', appName: v.app.name, cancelTo }

  const projects: ConsentProject[] = []
  for (const p of eligible) {
    // An archived (inactive) site is never offered — like the project switcher.
    const ref = await deps.store.getProject(p.projectId)
    if (!ref || ref.status === 'inactive') continue
    const live = await deps.store.findLiveConnection(v.app.id, p.projectId)
    projects.push({
      projectId: p.projectId,
      projectSlug: p.projectSlug ?? p.projectId,
      name: deps.projectNames?.[p.projectId]?.trim() || p.projectSlug || p.projectId,
      existing: live?.status ?? null,
      shared: live ? structuredClone(live.resources) : null,
    })
  }
  if (projects.length === 0) return { state: 'no_site', appName: v.app.name, cancelTo }
  projects.sort((a, b) => a.name.localeCompare(b.name))

  const hinted = params.project ? projects.find((p) => p.projectSlug === params.project) : undefined
  const preselectedProjectId = hinted?.projectId ?? (projects.length === 1 ? projects[0].projectId : null)

  const resources: ConsentResource[] = v.requested.map((name) => {
    const def = SHAREABLE_RESOURCES[name] as { public: readonly string[]; personal: readonly string[] }
    return {
      name,
      fields: [
        ...def.public.map((f) => ({ name: f, personal: false, checked: true })),
        ...def.personal.map((f) => ({ name: f, personal: true, checked: false })),
      ],
    }
  })

  return { state: 'ready', appName: v.app.name, resources, projects, preselectedProjectId, cancelTo, sandboxOnly }
}
