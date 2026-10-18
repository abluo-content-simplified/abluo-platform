import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { SupportRolePicker } from '@/components/admin/projects/SupportRolePicker'
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
        <Notice tone="error">{t(notice)}</Notice>
      ) : null}
      <form action={startSupportVisitAction} className="flex flex-wrap items-start gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="slug" value={slug} />
        <SupportRolePicker
          name="role"
          label={t('roleLabel')}
          hint={t('roleHint')}
          initial={DEFAULT_SUPPORT_ROLE}
          options={SUPPORT_ROLES.map((r) => ({ value: r, label: tRoles(r) }))}
        />
        <Button type="submit" variant="primary" className="mt-7">
          {t('open')}
        </Button>
      </form>
    </section>
  )
}
