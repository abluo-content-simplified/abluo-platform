'use client'

import { useTranslations } from 'next-intl'
import { Chip } from '@/components/app/ui/Chip'
import { Field } from '@/components/app/ui/Field'
import { Select } from '@/components/app/ui/Select'
import { MESSAGE_LIMITS, isPageLink, linkKey, type StoredLink } from '@/lib/messages/model'
import type { SitePageOption } from '@/lib/messages/site-pages'

/**
 * Links in a message (ADR-050 D4): up to 3, picked from lists — never a free
 * URL. Two side-by-side lists: a dashboard destination of the recipient's
 * site, or a page of their website ("Hey, look here"). Choosing adds it at
 * once (no extra Add button); chosen ones show as removable chips.
 *
 * `pages`: the site's published pages; null when the recipients are on more
 * than one site (a page belongs to one site) or still loading — the list is
 * then disabled and says why.
 */
export function LinkChooser({
  targets,
  pages,
  pagesReason,
  value,
  onChange,
  disabled = false,
}: {
  targets: string[]
  pages: SitePageOption[] | null
  /** Why the website list is unavailable (shown under it). */
  pagesReason?: string | null
  value: StoredLink[]
  onChange: (links: StoredLink[]) => void
  disabled?: boolean
}) {
  const t = useTranslations('admin.messages.links')
  const tNav = useTranslations('clientDashboard.nav')
  const navLabel = (id: string) => (tNav.has(id) ? tNav(id) : id)
  const chipLabel = (l: StoredLink) => (isPageLink(l) ? t('pageChip', { page: l.label || l.page || t('homePage') }) : navLabel(l.id))
  const full = value.length >= MESSAGE_LIMITS.linksMax
  const keys = new Set(value.map(linkKey))
  const add = (l: StoredLink) => {
    if (full || keys.has(linkKey(l))) return
    onChange([...value, l])
  }
  const leftTargets = targets.filter((id) => !keys.has(id))
  const leftPages = (pages ?? []).filter((p) => !keys.has(`page:${p.page}`))
  const noPages = pages !== null && pages.length === 0
  const reason = full ? t('full', { max: MESSAGE_LIMITS.linksMax }) : pages === null ? pagesReason ?? null : noPages ? t('noPages') : null

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
        <Field label={t('dashboardLabel')}>
          {(p) => (
            <Select
              {...p}
              value=""
              disabled={disabled || full}
              onChange={(e) => {
                if (e.target.value) add({ id: e.target.value })
              }}
            >
              <option value="">{t('choose')}</option>
              {leftTargets.map((id) => (
                <option key={id} value={id}>
                  {navLabel(id)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('websiteLabel')}>
          {(p) => (
            <Select
              {...p}
              value=""
              disabled={disabled || full || pages === null || noPages}
              onChange={(e) => {
                const page = (pages ?? []).find((x) => `page:${x.page}` === e.target.value)
                if (page) add({ page: page.page, label: page.label })
              }}
            >
              <option value="">{t('choosePage')}</option>
              {leftPages.map((pg) => (
                <option key={pg.page || '/'} value={`page:${pg.page}`}>
                  {pg.page ? `${pg.label} — /${pg.page}` : pg.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <p className="text-sm leading-5 text-muted-foreground">{reason ?? t('hint', { max: MESSAGE_LIMITS.linksMax })}</p>
      {value.length > 0 ? (
        <div className="flex flex-wrap items-start gap-2">
          {value.map((l) => (
            <Chip key={linkKey(l)} selected removable aria-label={t('remove', { place: chipLabel(l) })} disabled={disabled} onClick={() => onChange(value.filter((x) => linkKey(x) !== linkKey(l)))}>
              {chipLabel(l)}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  )
}
