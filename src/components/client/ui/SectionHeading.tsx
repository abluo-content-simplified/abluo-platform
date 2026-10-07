import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

/**
 * The heading of a dashboard block: an h2 on the left and, optionally, a
 * "See all" link on the right (44px tall, top-aligned with the heading).
 * Give the heading an `id` and point the section's `aria-labelledby` at it.
 *
 *   <section aria-labelledby="latest-posts" className="flex flex-col gap-3">
 *     <SectionHeading id="latest-posts" title={t('latestPosts')} seeAllHref="/abluo/posts" />
 *     …
 *   </section>
 */
export function SectionHeading({
  id,
  title,
  seeAllHref,
  seeAllLabel,
}: {
  id?: string
  title: string
  seeAllHref?: string | null
  /** Defaults to "See all". */
  seeAllLabel?: string
}) {
  const t = useTranslations('clientDashboard.ui.section')
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 id={id} className="text-[1.0625rem] leading-6 font-semibold">
        {title}
      </h2>
      {seeAllHref ? (
        <Link
          href={seeAllHref}
          aria-label={t('seeAllNamed', { section: title })}
          className="-my-2.5 inline-flex min-h-11 shrink-0 items-center rounded-md text-sm font-medium text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {seeAllLabel ?? t('seeAll')}
        </Link>
      ) : null}
    </div>
  )
}
