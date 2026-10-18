'use server'

/**
 * Client dashboard — Settings server actions (Tom, 2026-10-18).
 *
 * Thin wrappers over `src/lib/settings/service.ts`, which holds every check
 * (`site.details.write`, the fixed allow-list of writable paths, revision
 * guards, draft + published patching). Identity is re-resolved server-side on
 * each call; the URL's projectSlug only picks one of the caller's own grants.
 * Failures collapse to opaque codes. The shape matches the autosave engine
 * (`{ ok, rev } | { ok: false, error }`), so the page saves per field.
 */
import { revalidatePath } from 'next/cache'
import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { span, traced, withPerf, type PerfReport } from '@/lib/perf/timing'
import { SettingsError, saveSettings, type SettingsErrorCode } from '@/lib/settings/service'

export type SettingsActionError = 'unauthenticated' | 'forbidden' | SettingsErrorCode
/** `perf` is present only when perfEnabled() (never in production). */
type Fail = { ok: false; error: SettingsActionError; perf?: PerfReport }
type Result<T> = ({ ok: true; perf?: PerfReport } & T) | Fail

async function run<T>(
  op: string,
  projectSlug: unknown,
  fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>,
): Promise<Result<T>> {
  // The resolver call (resolveProjectAction) stays in this function's body: the
  // support-mode guard test (client-actions-guard) checks every action reaches it.
  return traced(`settings.${op}`, async (): Promise<Result<T>> =>
    withPerf(
      await (async (): Promise<Result<T>> => {
        const access = await span('auth', () => resolveProjectAction(projectSlug))
        if (!access.ok) return { ok: false, error: access.error }
        try {
          return { ok: true, ...(await fn(access.ctx, access.grant.projectId)) }
        } catch (error) {
          if (error instanceof SettingsError) return { ok: false, error: error.code }
          if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
          return { ok: false, error: 'failed' }
        }
      })(),
    ),
  )
}

/**
 * After a write: this page and the website are rendered fresh next time.
 * Patterns, not paths, so every language and project is covered; a failure to
 * revalidate never fails the write.
 */
function refresh() {
  try {
    revalidatePath('/[locale]/[tenant]/settings', 'page')
    revalidatePath('/[locale]/[tenant]', 'layout')
  } catch {
    /* not in a request (tests) — nothing to refresh */
  }
}

/**
 * Saves a batch of `{ path: value }` changes (allow-listed paths only, see
 * `lib/settings/paths.ts`). `rev` is the revision the page last held; the
 * result carries the new one. `conflict` = changed elsewhere (the page offers Reload).
 */
export async function saveSettingsAction(input: { projectSlug: string; rev: string; set: Record<string, unknown> }): Promise<Result<{ rev: string }>> {
  const result = await run('save', input?.projectSlug, (ctx, pid) => saveSettings(ctx, pid, { rev: input?.rev, set: input?.set }))
  if (result.ok) refresh()
  return result
}
