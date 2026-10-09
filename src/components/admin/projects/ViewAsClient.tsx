import { getTranslations } from 'next-intl/server'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { startSupportVisitAction } from '@/app/[locale]/(admin)/projects/[slug]/support-actions'
import { DEFAULT_SUPPORT_ROLE, SUPPORT_ROLES } from '@/lib/support/constants'

/**
 * "View as client" on the admin project page (ADR-028 §8, support mode).
 * A plain form — which role's dashboard to see (segmented, Owner by default) and one button; the
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
      <form action={startSupportVisitAction} className="flex flex-wrap items-start gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="slug" value={slug} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium text-foreground">{t('roleLabel')}</legend>
          <div className="inline-flex h-11 rounded-lg border border-input bg-background p-1">
            {SUPPORT_ROLES.map((r) => (
              <label key={r} className="relative">
                <input
                  type="radio"
                  name="role"
                  value={r}
                  defaultChecked={r === DEFAULT_SUPPORT_ROLE}
                  className="peer sr-only"
                />
                <span className="flex h-full cursor-pointer items-center rounded-md px-3 text-sm text-muted-foreground transition-colors peer-checked:bg-muted peer-checked:font-medium peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  {tRoles(r)}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs leading-4 text-muted-foreground">{t('roleHint')}</p>
        </fieldset>
        <button
          type="submit"
          className="mt-7 inline-flex h-11 items-center rounded-lg bg-action px-4 text-sm font-medium text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t('open')}
        </button>
      </form>
    </section>
  )
}
