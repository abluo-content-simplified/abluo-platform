'use client'

import { useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Select } from '@/components/app/ui/Select'
import { TextInput } from '@/components/app/ui/TextInput'
import { INTERFACE_LOCALES, LOCALE_NATIVE_NAMES } from '@/lib/i18n/locales'
import { inviteOwnerAction, type InviteOwnerResult } from '@/app/[locale]/(admin)/projects/[slug]/owner-actions'

type Owner = { userId: string; name: string; email: string }

/**
 * "Invite Owner" on the admin project page: the client's current Owners and a
 * button that opens a small sheet — email, the email's language (the languages
 * an invitation can be written in, defaulting to the site's default language)
 * and a note that the email goes out immediately. The server action checks
 * Super Admin + two-factor and refuses a duplicate open invitation unless the
 * admin explicitly sends a new one.
 */
export function InviteOwnerCard({ projectId, defaultLocale, owners }: { projectId: string; defaultLocale: string | null; owners: Owner[] | null }) {
  const t = useTranslations('admin.projectPage.inviteOwner')
  const format = useFormatter()
  const router = useRouter()
  const initialLocale = (INTERFACE_LOCALES as readonly string[]).includes(defaultLocale ?? '') ? (defaultLocale as string) : 'en'
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [locale, setLocale] = useState(initialLocale)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InviteOwnerResult | null>(null)

  const date = (iso?: string) => {
    const d = iso ? new Date(iso) : null
    return d && !Number.isNaN(d.getTime()) ? format.dateTime(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  }

  async function send(sendAgain: boolean) {
    setBusy(true)
    const r = await inviteOwnerAction({ projectId, email, locale, sendAgain })
    setBusy(false)
    setResult(r)
    if (r.ok) {
      setEmail('')
      router.refresh()
    }
  }

  const close = () => {
    setOpen(false)
    setResult(null)
  }

  return (
    <section aria-labelledby="owners-heading" className="flex flex-col gap-3">
      <div className="space-y-1">
        <SectionHeading id="owners-heading" title={t('heading')} />
        <p className="text-sm leading-5 text-muted-foreground">{t('body')}</p>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{t('current')}</p>
          {owners === null ? (
            <p className="text-muted-foreground">{t('unknown')}</p>
          ) : owners.length ? (
            <ul className="space-y-0.5">
              {owners.map((o) => (
                <li key={o.userId} className="break-all">
                  {o.name ? `${o.name} · ${o.email}` : o.email || o.userId}
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-medium text-destructive">{t('none')}</p>
          )}
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          {t('button')}
        </Button>
      </div>

      <BottomSheet open={open} title={t('title')} onClose={close}>
        <form
          className="flex flex-col gap-5 pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            void send(false)
          }}
        >
          <Field label={t('email')}>
            {(p) => (
              <TextInput
                {...p}
                type="email"
                required
                autoComplete="off"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setResult(null)
                }}
              />
            )}
          </Field>
          <Field label={t('language')} hint={t('languageHint')}>
            {(p) => (
              <Select {...p} value={locale} onChange={(e) => setLocale(e.target.value)}>
                {INTERFACE_LOCALES.map((code) => (
                  <option key={code} value={code}>
                    {LOCALE_NATIVE_NAMES[code]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Notice tone="info">{t('note')}</Notice>

          {result?.ok ? (
            result.emailSent ? (
              <Notice tone="neutral">{t('sent', { email: result.email })}</Notice>
            ) : (
              <Notice tone="error">{t('sentNoEmail', { email: result.email })}</Notice>
            )
          ) : result && result.error === 'already_invited' ? (
            <Notice
              tone="dashed"
              action={
                <Button variant="secondary" disabled={busy} onClick={() => void send(true)}>
                  {t('sendAgain')}
                </Button>
              }
            >
              {t('errors.already_invited', { email: email.trim(), date: date(result.expiresAt) })} {t('sendAgainHint')}
            </Notice>
          ) : result ? (
            <Notice tone="error">{t(`errors.${result.error}`)}</Notice>
          ) : null}

          <Button variant="primary" size="lg" fullWidth type="submit" disabled={busy || !email.trim()}>
            {busy ? t('sending') : t('send')}
          </Button>
        </form>
      </BottomSheet>
    </section>
  )
}
