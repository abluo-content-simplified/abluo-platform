'use server'

/**
 * Client dashboard — Settings server actions: form notifications
 * (Tom, 2026-10-28). Who receives the emails of the website's forms.
 *
 * Thin wrappers over `src/lib/notifications/form-recipients-service.ts`, which
 * holds every check (`site.details.write`, the address rules, revision guards,
 * published + draft patching, the audit row, the production-only notice).
 * Identity is re-resolved server-side on each call (resolveProjectAction, the
 * support-aware resolver: a view-only support visit has no write permission);
 * the URL's projectSlug only picks one of the caller's own grants. Failures
 * collapse to opaque codes.
 *
 * The affiliate programs action that used to live here moved to Connected Apps
 * (`apps/affiliate-actions.ts`) on 2026-10-28.
 */
import { revalidatePath } from 'next/cache'
import { resolveProjectAction } from '@/lib/api/project-action'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import {
  FormNotificationsError,
  changeFormRecipient,
  type FormNotificationsErrorCode,
  type FormNotificationsView,
  type NoticeOutcome,
} from '@/lib/notifications/form-recipients-service'

export type FormRecipientActionError = 'unauthenticated' | 'forbidden' | FormNotificationsErrorCode
export type FormRecipientActionResult = { ok: true; view: FormNotificationsView; notice: NoticeOutcome } | { ok: false; error: FormRecipientActionError }

type Input = { projectSlug: string; locale: string; rev: string; groupKey: string; email: string }

async function change(op: 'add' | 'remove', input: Input): Promise<FormRecipientActionResult> {
  const access = await resolveProjectAction(input?.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  try {
    const r = await changeFormRecipient(access.ctx, access.grant.projectId, {
      op,
      rev: input?.rev,
      groupKey: input?.groupKey,
      email: input?.email,
      locale: typeof input?.locale === 'string' ? input.locale : 'en',
    })
    try {
      revalidatePath('/[locale]/[tenant]/settings', 'page')
    } catch {
      /* not in a request (tests) — nothing to refresh */
    }
    return { ok: true, ...r }
  } catch (error) {
    if (error instanceof FormNotificationsError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

/** Adds one address to one form's list. The new address gets a short notice email (production only). */
export async function addFormRecipientAction(input: Input): Promise<FormRecipientActionResult> {
  return change('add', input)
}

/** Removes one address from one form's list (the page asks first when it is the last one). */
export async function removeFormRecipientAction(input: Input): Promise<FormRecipientActionResult> {
  return change('remove', input)
}
