// ─── Studio › <project> › Modules — the overview pane ────────────────────────
//
// LIVE list of the modules for one project: switched-on modules first, a
// divider, then the ones that are off (Tom, 2026-09-30). Clicking a row opens
// that module's own pane (ModuleList) to the right, exactly as before.
//
// Why a component pane and not S.list(): list-item titles are strings fixed
// when the structure resolves ("Events — off"), and the Studio keeps the
// resolved pane when you navigate back to it. So switching a module on in its
// own pane never updated this list without a full Studio reload — the fix in
// 085b72b (re-fetch when the list resolves) could not help, because the list
// is not re-resolved. This pane subscribes to the project document instead
// and re-renders on every change, wherever the change came from.
//
// Admin-only Studio UI: English labels are acceptable here (CLAUDE.md,
// Localization Requirements — exceptions: Sanity Studio utilities).

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useClient } from 'sanity'
import { usePaneRouter } from 'sanity/structure'
import { MODULE_REGISTRY } from '../../modules'

interface ModulesOverviewProps {
  options?: { projectId?: string; projectSlug?: string }
}

import { enabledModuleIdsFrom, splitModules, type Installation } from './modules-overview'

export function ModulesOverview({ options }: ModulesOverviewProps) {
  const projectId = options?.projectId
  const client = useClient({ apiVersion: '2026-05-21' })
  const { ChildLink, routerPanesState, groupIndex } = usePaneRouter()
  const [enabledIds, setEnabledIds] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let alive = true
    const query = `*[_type == "project" && _id == $id][0].moduleInstallations[]{moduleId, enabled}`
    client
      .fetch<Installation[] | null>(query, { id: projectId })
      .then((rows) => alive && setEnabledIds(enabledModuleIdsFrom(rows)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))

    // Every mutation to the project (from ModuleList, another tab, a script)
    // re-renders this pane. `includeResult` carries the new document.
    const sub = client
      .listen<{ moduleInstallations?: Installation[] }>(`*[_id == $id]`, { id: projectId }, { includeResult: true, visibility: 'query' })
      .subscribe({
        next: (event) => {
          if (event.type === 'mutation' && event.result) setEnabledIds(enabledModuleIdsFrom(event.result.moduleInstallations))
        },
        error: () => {/* keep the last known state; the next pane open re-fetches */},
      })
    return () => {
      alive = false
      sub.unsubscribe()
    }
  }, [client, projectId])

  const { active, inactive } = useMemo(
    () => splitModules(MODULE_REGISTRY, enabledIds ?? []),
    [enabledIds]
  )

  // Which module pane is open to the right, to highlight its row.
  const openChildId = routerPanesState?.[groupIndex + 1]?.[0]?.id

  if (!projectId) return <p style={note}>No project.</p>
  if (error) return <p style={note}>Could not load modules: {error}</p>
  if (!enabledIds) return <p style={note}>Loading…</p>

  const row = (mod: (typeof MODULE_REGISTRY)[number], on: boolean) => (
    <ChildLink key={mod.id} childId={mod.id}>
      <div
        style={{
          ...rowStyle,
          background: openChildId === mod.id ? 'var(--card-selected-bg-color, rgba(128,128,128,.18))' : undefined,
          opacity: on ? 1 : 0.62,
        }}
      >
        <span style={{ ...dot, background: on ? 'var(--card-badge-positive-dot-color, #3ab667)' : 'transparent', borderColor: on ? 'transparent' : 'var(--card-border-color, #999)' }} />
        <span style={{ flex: 1 }}>{mod.label}</span>
        <span style={status}>{on ? 'on' : 'off'}</span>
      </div>
    </ChildLink>
  )

  return (
    <div className="abluo-modules-overview" style={{ padding: 8 }}>
      {/* ChildLink renders an <a> and takes no style prop: neutralise link styling here. */}
      <style>{'.abluo-modules-overview a{color:inherit;text-decoration:none;display:block}'}</style>
      <div style={groupLabel}>Active · {active.length}</div>
      {active.length ? active.map((m) => row(m, true)) : <p style={note}>No modules switched on.</p>}
      <hr style={divider} />
      <div style={groupLabel}>Not active · {inactive.length}</div>
      {inactive.map((m) => row(m, false))}
    </div>
  )
}

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 4, fontSize: 14, cursor: 'pointer' }
const dot: CSSProperties = { width: 8, height: 8, borderRadius: 8, border: '1px solid', flex: 'none' }
const status: CSSProperties = { fontSize: 12, color: 'var(--card-muted-fg-color, #888)' }
const groupLabel: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--card-muted-fg-color, #888)', padding: '12px 12px 6px' }
const divider: CSSProperties = { border: 0, borderTop: '1px solid var(--card-border-color, #ddd)', margin: '10px 12px' }
const note: CSSProperties = { fontSize: 13, color: 'var(--card-muted-fg-color, #888)', padding: '8px 12px', margin: 0 }
