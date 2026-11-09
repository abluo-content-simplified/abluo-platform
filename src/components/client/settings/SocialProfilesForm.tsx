'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { saveSocialProfilesAction } from '@/app/[locale]/(client)/[tenant]/settings/social-profiles/actions'
import {
  MAX_SOCIAL_LINKS,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  cleanSocialUrl,
  type SocialLinkRow,
  type SocialPlatform,
} from '@/lib/settings/social-links'
import { formatSocialProfilesMessage, getSocialProfilesMessages } from '@/lib/i18n/social-profiles-messages'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { Select } from '@/components/app/ui/Select'
import { TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'

function newKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  } catch {
    return Math.random().toString(36).slice(2, 14)
  }
}

const same = (a: readonly SocialLinkRow[], b: readonly SocialLinkRow[]) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Settings → Social Profiles (ADR-049 Amendment A): the website's social
 * profiles, in order. Add, edit, remove, move up / down; Save (top right)
 * writes the whole list and it is live at once. Addresses are checked as you
 * type (https, on the chosen network); Save says why it is disabled. After a
 * save: "Done · Undo" (Undo saves the previous list back).
 */
export function SocialProfilesForm({
  projectSlug,
  rev: initialRev,
  initial,
  live = initial,
  unpublished = false,
  canWrite,
}: {
  projectSlug: string
  rev: string
  /** The latest list — Studio's unpublished Website Settings draft when there is one. */
  initial: SocialLinkRow[]
  /** What the website shows now (published). */
  live?: SocialLinkRow[]
  /** Studio's draft differs from the website: show the latest list, say so, and let Save put it live. */
  unpublished?: boolean
  canWrite: boolean
}) {
  const t = getSocialProfilesMessages(useLocale())
  const [rows, setRows] = useState<SocialLinkRow[]>(initial)
  // Compared with what is LIVE: a list waiting in Studio can be saved (= made live) at once.
  const [saved, setSaved] = useState<SocialLinkRow[]>(live)
  const [pendingInStudio, setPendingInStudio] = useState(unpublished)
  const [rev, setRev] = useState(initialRev)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const { toast, show } = useUndo()

  const problems = rows.map((r) => {
    const c = cleanSocialUrl(r.platform, r.url)
    if (c.ok) return null
    return c.problem === 'empty' ? t.problemEmpty : c.problem === 'wrong_platform' ? formatSocialProfilesMessage(t.problemWrongPlatform, { platform: SOCIAL_PLATFORM_LABELS[r.platform] }) : t.problemNotHttps
  })
  const changed = !same(rows, saved)
  const invalid = problems.some(Boolean)
  const reason = !changed ? t.reasonNoChanges : invalid ? t.reasonInvalid : null
  const full = rows.length >= MAX_SOCIAL_LINKS

  async function write(list: SocialLinkRow[], fromRev: string): Promise<string | null> {
    const payload = list.map((r) => {
      const c = cleanSocialUrl(r.platform, r.url)
      return { _key: r._key, platform: r.platform, url: c.ok ? c.url : r.url }
    })
    const r = await saveSocialProfilesAction({ projectSlug, rev: fromRev, socialLinks: payload })
    if (r.ok) return r.rev
    if (r.error === 'conflict') setConflict(true)
    setError(r.error === 'conflict' ? t.errorConflict : r.error === 'invalid_value' || r.error === 'too_many' ? t.errorInvalid : t.errorFailed)
    return null
  }

  async function save() {
    if (busy || reason || !canWrite) return
    setBusy(true)
    setError(null)
    const previous = saved
    const list = rows.map((r) => {
      const c = cleanSocialUrl(r.platform, r.url)
      return c.ok ? { ...r, url: c.url } : r
    })
    try {
      const next = await write(list, rev)
      if (!next) return
      setRev(next)
      setRows(list)
      setSaved(list)
      // A save writes the website AND Studio's draft: nothing is waiting any more.
      setPendingInStudio(false)
      show(
        {
          message: `${t.done} · ${t.saved}`,
          tone: 'status',
          undo: () => {
            show(null)
            void (async () => {
              setBusy(true)
              try {
                const back = await write(previous, next)
                if (back) {
                  setRev(back)
                  setRows(previous)
                  setSaved(previous)
                }
              } finally {
                setBusy(false)
              }
            })()
          },
        },
        8000
      )
    } catch {
      setError(t.errorFailed)
    } finally {
      setBusy(false)
    }
  }

  const update = (key: string, patch: Partial<SocialLinkRow>) => setRows((list) => list.map((r) => (r._key === key ? { ...r, ...patch } : r)))
  const move = (index: number, by: -1 | 1) =>
    setRows((list) => {
      const next = [...list]
      const [row] = next.splice(index, 1)
      next.splice(index + by, 0, row)
      return next
    })
  const firstUnused = (): SocialPlatform => SOCIAL_PLATFORMS.find((p) => !rows.some((r) => r.platform === p)) ?? 'instagram'

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.title}
        actions={
          canWrite ? (
            <Button variant="primary" disabled={busy || Boolean(reason)} aria-describedby="social-save-reason" onClick={() => void save()}>
              {busy ? t.saving : t.save}
            </Button>
          ) : null
        }
      />
      <div className="space-y-1">
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t.intro}</p>
        {canWrite && reason && changed ? (
          <p id="social-save-reason" className="text-sm leading-5 text-muted-foreground">
            {reason}
          </p>
        ) : (
          <span id="social-save-reason" className="sr-only">
            {reason ?? ''}
          </span>
        )}
      </div>
      {!canWrite ? <Notice tone="info">{t.readOnly}</Notice> : null}
      {pendingInStudio ? <Notice tone="info">{canWrite ? t.unpublished : t.unpublishedReadOnly}</Notice> : null}
      {error ? (
        <Notice
          tone="error"
          onDismiss={() => setError(null)}
          dismissLabel={t.dismiss}
          action={conflict ? <Button onClick={() => window.location.reload()}>{t.reload}</Button> : undefined}
        >
          {error}
        </Notice>
      ) : null}

      {rows.length === 0 ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t.empty}</p> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((r, i) => {
          const name = SOCIAL_PLATFORM_LABELS[r.platform]
          const items: CardMenuItem[] = [
            ...(i > 0 ? [{ key: 'up', label: t.moveUp, onSelect: () => move(i, -1) }] : []),
            ...(i < rows.length - 1 ? [{ key: 'down', label: t.moveDown, onSelect: () => move(i, 1) }] : []),
            { key: 'remove', label: t.remove, destructive: true, separated: true, onSelect: () => setRows((list) => list.filter((x) => x._key !== r._key)) },
          ]
          return (
            <Panel as="li" key={r._key} className="space-y-3">
              <div className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                  <Field label={t.platform}>
                    {(p) => (
                      <Select {...p} value={r.platform} disabled={!canWrite} onChange={(e) => update(r._key, { platform: e.target.value as SocialPlatform })}>
                        {SOCIAL_PLATFORMS.map((pl) => (
                          <option key={pl} value={pl}>
                            {SOCIAL_PLATFORM_LABELS[pl]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={t.address} hint={t.addressHint} error={r.url.trim() && problems[i] ? problems[i] : undefined}>
                    {(p) => (
                      <TextInput
                        {...p}
                        type="url"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={r.url}
                        readOnly={!canWrite}
                        maxLength={300}
                        placeholder="https://"
                        onChange={(e) => update(r._key, { url: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                {canWrite ? (
                  <div className="pt-7">
                    <CardMenu label={formatSocialProfilesMessage(t.rowActions, { name })} items={items} />
                  </div>
                ) : null}
              </div>
            </Panel>
          )
        })}
      </ul>
      {canWrite ? (
        <div className="flex flex-col items-start gap-1">
          <Button disabled={full} aria-describedby={full ? 'social-full' : undefined} onClick={() => setRows((list) => [...list, { _key: newKey(), platform: firstUnused(), url: '' }])}>
            {t.add}
          </Button>
          {full ? (
            <p id="social-full" className="text-sm leading-5 text-muted-foreground">
              {formatSocialProfilesMessage(t.full, { max: MAX_SOCIAL_LINKS })}
            </p>
          ) : null}
        </div>
      ) : null}
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t.undo : undefined} onAction={toast?.undo} />
    </div>
  )
}
