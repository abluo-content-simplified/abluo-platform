'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { FactRow } from '@/components/app/ui/FactRow'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { AvatarEditor } from '@/components/client/account/AvatarEditor'
import { TwoFactorPill } from '@/components/client/people/people-bits'

/**
 * The person's profile in place (Tom, 2026-10-08): a side panel on computers,
 * a sheet on phones — the same content as the Account page, which stays the
 * real URL for links from emails ("Open full page").
 */
export type ProfileData = {
  name: string
  email: string
  avatarUrl: string | null
  twoFactor: boolean | null
  /** Every site this person works on, with their role there (labels already localized). */
  access: { slug: string; name: string; role: string }[]
}

export function ProfilePanel({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: ProfileData }) {
  const t = useTranslations('account')
  const tMenu = useTranslations('app.accountMenu')
  return (
    <SidePanel open={open} title={t('profile')} subtitle={profile.email} closeLabel={tMenu('close')} onClose={onClose}>
      <div className="flex flex-col gap-6">
        <AvatarEditor name={profile.name} email={profile.email} src={profile.avatarUrl} />
        <dl>
          <FactRow label={t('name')}>{profile.name || <span className="text-muted-foreground">{t('notSet')}</span>}</FactRow>
          <FactRow label={t('email')}>{profile.email}</FactRow>
          {profile.twoFactor !== null ? (
            <FactRow label={t('twoStep')}>
              <TwoFactorPill on={profile.twoFactor} />
            </FactRow>
          ) : null}
        </dl>
        {profile.access.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{t('access')}</h3>
            <dl>
              {profile.access.map((a) => (
                <FactRow key={a.slug} label={a.name}>
                  {a.role}
                </FactRow>
              ))}
            </dl>
          </section>
        ) : null}
        <Link href="/account" onClick={onClose} className="self-start text-[0.9375rem] font-medium underline underline-offset-4">
          {t('openFullPage')}
        </Link>
      </div>
    </SidePanel>
  )
}
