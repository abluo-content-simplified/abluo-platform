import { getTranslations } from 'next-intl/server'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { startSupportVisitAction } from '@/app/[locale]/(admin)/projects/[slug]/support-actions'
import { DEFAULT_SUPPORT_ROLE, SUPPORT_ROLES } from '@/lib/support/constants'

/**
 * "View as client" on the admin project page (ADR-028 §8, support mode).
 * A plain form — the role perspective (Owner by default) and one button; the
 * server action checks admin + two-factor, opens the visit, logs it and lands
 * on the client's Home. `notice` is the result of a failed attempt.
 */
export async function ViewAsClient({
  projectId,
  slug,
  notice,
}: {
  projectId: string
  slug: string
  notice: 'unavailable' | 'failed' | null
}) {
  const t = await getTranslations('admin.projectPage.support')
  const tRoles = await getTranslations('app.roles')
  return (
    <section aria-labelledby="support-heading" className="flex flex-col gap-3">
      <div className="space-y-1">
        <SectionHeading id="support-heading" title={t('heading')} />
        <p className="text-sm leading-5 text-muted-foreground">{t('body')}</p>
      </div>
      {notice ? (
        <p role="alert" className="rounded-2xl border border-destructive px-4 py-3 text-sm text-destructive">
          {t(notice)}
        </p>
      ) : null}
      <form action={startSupportVisitAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="slug" value={slug} />
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          {t('roleLabel')}
          <select
            name="role"
            defaultValue={DEFAULT_SUPPORT_ROLE}
            className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {SUPPORT_ROLES.map((r) => (
              <option key={r} value={r}>
                {tRoles(r)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-lg bg-action px-4 text-sm font-medium text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t('open')}
        </button>
      </form>
    </section>
  )
}
