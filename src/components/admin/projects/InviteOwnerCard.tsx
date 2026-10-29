'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Select } from '@/components/app/ui/Select'
import { TextInput } from '@/components/app/ui/TextInput'
import { INTERFACE_LOCALES, LOCALE_NATIVE_NAMES } from '@/lib/i18n/locales'
import { inviteOwnerAction, makeOwnerAction, type InviteOwnerResult, type MakeOwnerResult } from '@/app/[locale]/(admin)/projects/[slug]/owner-actions'
import { useDateLocale } from '@/lib/i18n/date-locale-context'
import { formatDateTime } from '@/lib/i18n/date-locale'

type Owner = { userId: string; name: string; email: string }
type Candidate = { userId: string; name: string; email: string }

const personLabel = (p: { userId: string; name: string; email: string }) => (p.name ? `${p.name} · ${p.email}` : p.email || p.userId)

/**
 * "Invite Owner" on the admin project page: the client's current Owners and a
 * button that opens a small sheet — email, the email's language (the languages
 * an invitation can be written in, defaulting to the site's default language)
 * and a note that the email goes out immediately. The server action checks
 * Super Admin + two-factor and refuses a duplicate open invitation unless the
 * admin explicitly sends a new one.
 */
export function InviteOwnerCard({
  projectId,
  defaultLocale,
  owners,
  candidates = null,
}: {
  projectId: string
  defaultLocale: string | null
  owners: Owner[] | null
  /** People already in the client who are not Owners ("Make owner", PLAT-2); null = couldn't load. */
  candidates?: Candidate[] | null
}) {
  const t = useTranslations('admin.projectPage.inviteOwner')
  const dateLocale = useDateLocale()
  const router = useRouter()
  const initialLocale = (INTERFACE_LOCALES as readonly string[]).includes(defaultLocale ?? '') ? (defaultLocale as string) : 'en'
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [locale, setLocale] = useState(initialLocale)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InviteOwnerResult | null>(null)

  const date = (iso?: string) => {
    const d = iso ? new Date(iso) : null
    return d && !Number.isNaN(d.getTime()) ? formatDateTime(dateLocale, d, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
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
        <div className="flex flex-wrap gap-2">
          {candidates !== null ? <MakeOwnerButton projectId={projectId} locale={initialLocale} owners={owners ?? []} candidates={candidates} /> : null}
          <Button variant="primary" onClick={() => setOpen(true)}>
            {t('button')}
          </Button>
        </div>
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

/**
 * "Make owner" (PLAT-2): pick a person who is already in the client, and
 * optionally the current Owner who steps down to Site admin on every site.
 * The sheet names the person before anything happens; the server re-checks
 * everything (Super Admin + two-factor, membership, never without an Owner).
 */
function MakeOwnerButton({ projectId, locale, owners, candidates }: { projectId: string; locale: string; owners: Owner[]; candidates: Candidate[] }) {
  const t = useTranslations('admin.projectPage.inviteOwner')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState('')
  const [stepDown, setStepDown] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MakeOwnerResult | null>(null)
  const [doneName, setDoneName] = useState('')
  const person = candidates.find((c) => c.userId === userId) ?? null
  const leaving = owners.find((o) => o.userId === stepDown) ?? null
  const name = (p: { name: string; email: string; userId: string } | null) => (p ? p.name || p.email || p.userId : '')

  const close = () => {
    setOpen(false)
    setResult(null)
    setUserId('')
    setStepDown('')
  }

  async function submit() {
    if (!person) return
    setBusy(true)
    setDoneName(name(person))
    const r = await makeOwnerAction({ projectId, userId: person.userId, stepDownUserId: stepDown || null, locale })
    setBusy(false)
    setResult(r)
    if (r.ok) router.refresh()
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('makeOwnerButton')}
      </Button>
      <BottomSheet open={open} title={t('makeOwnerTitle')} onClose={close}>
        {candidates.length === 0 ? (
          <Notice tone="info">{t('makeOwnerNoCandidates')}</Notice>
        ) : (
          <form
            className="flex flex-col gap-5 pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <Field label={t('makeOwnerPerson')} hint={t('makeOwnerPersonHint')}>
              {(p) => (
                <Select
                  {...p}
                  required
                  value={userId}
                  onChange={(e) => {
                    setUserId(e.target.value)
                    setResult(null)
                  }}
                >
                  <option value="">—</option>
                  {candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {personLabel(c)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {owners.length ? (
              <Field label={t('makeOwnerStepDown')}>
                {(p) => (
                  <Select
                    {...p}
                    value={stepDown}
                    onChange={(e) => {
                      setStepDown(e.target.value)
                      setResult(null)
                    }}
                  >
                    <option value="">{t('makeOwnerStepDownNone')}</option>
                    {owners.map((o) => (
                      <option key={o.userId} value={o.userId}>
                        {personLabel(o)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {person ? (
              <Notice tone="neutral">
                {leaving
                  ? t('makeOwnerConfirmStepDown', { name: name(person), owner: name(leaving) })
                  : t('makeOwnerConfirm', { name: name(person) })}{' '}
                {t('makeOwnerNote')}
              </Notice>
            ) : null}
            {result?.ok ? (
              <Notice tone="neutral">{t('makeOwnerDone', { name: doneName })}</Notice>
            ) : result ? (
              <Notice tone="error">{t(`makeOwnerErrors.${result.error}`)}</Notice>
            ) : null}
            <Button variant="primary" size="lg" fullWidth type="submit" disabled={busy || !person || result?.ok === true}>
              {busy ? t('makeOwnerSaving') : t('makeOwnerSubmit')}
            </Button>
          </form>
        )}
      </BottomSheet>
    </>
  )
}
