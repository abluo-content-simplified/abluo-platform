'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useClient } from 'sanity'
import { Box, Button, Card, Checkbox, Flex, Stack, Text, TextArea, TextInput } from '@sanity/ui'
import { LOCALE_CODES, PLATFORM_LOCALES, type SupportedLocale } from '../../i18n/locales'
import {
  invalidEmails,
  isLocaleKey,
  isRevisionConflict,
  notificationsPatchPlan,
  newRecipientGroup,
  parseEmails,
  toForm,
  toStored,
  type NotificationsForm,
  type RecipientGroup,
  type StoredNotifications,
} from './notifications-form'

/**
 * NotificationsPane — Project Settings > Notifications.
 *
 * Edits `project.notifications` (ADR-019 + Amendment A): who gets the
 * "new submission" email, and how that email is personalised. Same
 * conventions as PrivacyPane: fetch once against the published project id,
 * patch the published document directly. Because this is a multi-field form
 * (not single toggles) it has an explicit Save button instead of auto-commit.
 */

interface NotificationsPaneProps {
  options?: { projectId?: string; projectSlug?: string }
}

interface Loaded {
  _rev?: string
  notifications?: StoredNotifications
  supportedLocales?: string[]
}

export function NotificationsPane({ options }: NotificationsPaneProps) {
  const projectId = options?.projectId
  const projectSlug = options?.projectSlug
  const client = useClient({ apiVersion: '2026-05-21' })

  const [stored, setStored] = useState<StoredNotifications | null>(null)
  const [form, setForm] = useState<NotificationsForm>(() => toForm(null))
  // Raw text of each recipient's email box, so typing separators isn't eaten.
  const [emailText, setEmailText] = useState<Record<string, string>>({})
  const [siteLocales, setSiteLocales] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  // Revision of the published document as loaded; a save against a newer one is refused.
  const [revision, setRevision] = useState<string | null>(null)

  const applyLoaded = useCallback((n: StoredNotifications | undefined) => {
    const f = toForm(n)
    setStored(n ?? null)
    setForm(f)
    setEmailText(Object.fromEntries(f.recipients.map((r) => [r._key, r.emails.join(', ')])))
    setDirty(false)
  }, [])

  const load = useCallback(() => {
    if (!projectId) {
      setLoading(false)
      return Promise.resolve()
    }
    setLoading(true)
    return client
      .fetch<Loaded | null>(
        `*[_type == "project" && _id == $projectId][0]{
          _rev,
          notifications,
          "supportedLocales": *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].supportedLocales
        }`,
        { projectId }
      )
      .then((data) => {
        applyLoaded(data?.notifications)
        setRevision(data?._rev ?? null)
        setSiteLocales(Array.isArray(data?.supportedLocales) ? data!.supportedLocales! : [])
      })
      .catch(() => setError('Failed to load notification settings.'))
      .finally(() => setLoading(false))
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load()
  }, [load])

  // Languages shown for the intro line: the website's languages, plus any
  // locale that already has text stored (so nothing is silently hidden).
  const introLocales = useMemo<SupportedLocale[]>(() => {
    const wanted = new Set<string>([...siteLocales, ...Object.keys(form.internalEmail.intro).filter(isLocaleKey)])
    const list = LOCALE_CODES.filter((c) => wanted.has(c))
    return list.length ? list : (['en'] as SupportedLocale[])
  }, [siteLocales, form.internalEmail.intro])

  const edit = useCallback((fn: (f: NotificationsForm) => NotificationsForm) => {
    setForm(fn)
    setDirty(true)
    setSaved(false)
    setSaveError(null)
  }, [])

  const updateGroup = (key: string, patch: Partial<RecipientGroup>) =>
    edit((f) => ({ ...f, recipients: f.recipients.map((r) => (r._key === key ? { ...r, ...patch } : r)) }))

  const setEmails = (key: string, text: string) => {
    setEmailText((t) => ({ ...t, [key]: text }))
    updateGroup(key, { emails: parseEmails(text) })
  }

  const badEmails = form.recipients.flatMap((r) => invalidEmails(r.emails))

  const save = useCallback(async () => {
    if (!projectId) return
    setSaveError(null)
    setSaved(false)
    if (badEmails.length) {
      setSaveError(`Check these email addresses: ${badEmails.join(', ')}`)
      return
    }
    setSaving(true)
    try {
      const next = toStored(form, stored)
      const draftExists = !!(await client.fetch<string | null>(`*[_id == $id][0]._id`, { id: `drafts.${projectId}` }))
      const tx = client.transaction()
      for (const p of notificationsPatchPlan(projectId, revision, draftExists, next)) {
        tx.patch(p.id, (patch) => (p.ifRevisionId ? patch.ifRevisionId(p.ifRevisionId) : patch).set(p.set))
      }
      await tx.commit()
      await load() // fresh revision for the next save
      setSaved(true)
    } catch (e) {
      if (isRevisionConflict(e)) {
        setSaveError('Changed elsewhere — reloaded the latest settings. Please make your change again.')
        await load()
      } else {
        setSaveError('Failed to save. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }, [projectId, form, stored, badEmails, client, revision, load])

  if (!projectId) return <div style={{ padding: 32, fontSize: 13, color: '#aaa' }}>No project selected.</div>
  if (loading) return <div style={{ padding: 32, fontSize: 13, color: '#aaa' }}>Loading notification settings…</div>
  if (error) {
    return (
      <div style={{ padding: 32, fontSize: 13, color: '#c62828', background: '#ffebee', borderRadius: 4, margin: 32 }}>
        {error}
      </div>
    )
  }

  const hint = { fontSize: 12, color: '#888', lineHeight: 1.5 } as const

  return (
    <Box padding={5} style={{ maxWidth: 680 }}>
      <Stack space={5}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Notifications{projectSlug ? ` — ${projectSlug}` : ''}
        </div>

        {/* ── Recipients ───────────────────────────────────────────────── */}
        <Stack space={3}>
          <Text size={2} weight="semibold">Recipients</Text>
          <div style={hint}>
            Who gets notified when a form on this project receives a new submission. One group per topic. Topic
            &ldquo;all&rdquo; (or blank) matches every form.
          </div>
          {form.recipients.length === 0 && <div style={hint}>No recipient groups yet.</div>}
          {form.recipients.map((r) => {
            const bad = invalidEmails(r.emails)
            return (
              <Card key={r._key} padding={3} radius={2} border tone={bad.length ? 'critical' : 'default'}>
                <Stack space={3}>
                  <Stack space={2}>
                    <Text size={1} weight="medium">Topic</Text>
                    <TextInput
                      value={r.topic}
                      onChange={(e) => updateGroup(r._key, { topic: e.currentTarget.value })}
                    />
                    <div style={hint}>e.g. &ldquo;early-access&rdquo;, or &ldquo;all&rdquo; for every form.</div>
                  </Stack>
                  <Stack space={2}>
                    <Text size={1} weight="medium">Emails</Text>
                    <TextArea
                      rows={2}
                      value={emailText[r._key] ?? ''}
                      onChange={(e) => setEmails(r._key, e.currentTarget.value)}
                      placeholder="name@example.com, other@example.com"
                    />
                    <div style={hint}>Recipient email addresses, separated by commas or new lines.</div>
                    {bad.length > 0 && (
                      <div role="alert" style={{ fontSize: 12, color: '#c62828' }}>
                        Not a valid email: {bad.join(', ')}
                      </div>
                    )}
                  </Stack>
                  <Flex align="center" justify="space-between">
                    <Flex as="label" align="center" gap={2}>
                      <Checkbox checked={r.enabled} onChange={(e) => updateGroup(r._key, { enabled: e.currentTarget.checked })} />
                      <Text size={1}>Enabled</Text>
                    </Flex>
                    <Button
                      text="Remove"
                      mode="bleed"
                      tone="critical"
                      fontSize={1}
                      onClick={() => edit((f) => ({ ...f, recipients: f.recipients.filter((x) => x._key !== r._key) }))}
                    />
                  </Flex>
                </Stack>
              </Card>
            )
          })}
          <div>
            <Button
              text="Add recipient group"
              mode="ghost"
              fontSize={1}
              onClick={() => {
                const g = newRecipientGroup()
                edit((f) => ({ ...f, recipients: [...f.recipients, g] }))
                setEmailText((t) => ({ ...t, [g._key]: '' }))
              }}
            />
          </div>
        </Stack>

        {/* ── Internal email ───────────────────────────────────────────── */}
        <Stack space={3}>
          <Text size={2} weight="semibold">Internal Email</Text>
          <div style={hint}>How the &ldquo;new submission&rdquo; notification looks and who it appears to come from.</div>

          <Stack space={2}>
            <Text size={1} weight="medium">From Name</Text>
            <TextInput
              value={form.internalEmail.fromName}
              onChange={(e) => {
                const v = e.currentTarget.value
                edit((f) => ({ ...f, internalEmail: { ...f.internalEmail, fromName: v } }))
              }}
            />
            <div style={hint}>
              Sender display name — e.g. &ldquo;Livener&rdquo;. Defaults to the client name. The address stays
              no-reply@mail.abluo.app.
            </div>
          </Stack>

          <Stack space={2}>
            <Text size={1} weight="medium">Subject</Text>
            <TextInput
              value={form.internalEmail.subjectTemplate}
              onChange={(e) => {
                const v = e.currentTarget.value
                edit((f) => ({ ...f, internalEmail: { ...f.internalEmail, subjectTemplate: v } }))
              }}
            />
            <div style={hint}>
              Tokens: {'{topic}'}, {'{who}'}, {'{formId}'}. Default: &ldquo;New {'{topic}'} submission — {'{who}'}&rdquo;.
            </div>
          </Stack>

          <Stack space={2}>
            <Text size={1} weight="medium">Intro Line</Text>
            <div style={hint}>One line under the heading (localized).</div>
            {introLocales.map((code) => (
              <Stack key={code} space={1}>
                <Text size={0} muted>{PLATFORM_LOCALES[code].nativeName}</Text>
                <TextArea
                  rows={2}
                  value={form.internalEmail.intro[code] ?? ''}
                  onChange={(e) => {
                    const v = e.currentTarget.value
                    edit((f) => ({
                      ...f,
                      internalEmail: { ...f.internalEmail, intro: { ...f.internalEmail.intro, [code]: v } },
                    }))
                  }}
                />
              </Stack>
            ))}
          </Stack>

          <Flex as="label" align="center" gap={2}>
            <Checkbox
              checked={form.internalEmail.replyToSubmitter}
              onChange={(e) => {
                const v = e.currentTarget.checked
                edit((f) => ({ ...f, internalEmail: { ...f.internalEmail, replyToSubmitter: v } }))
              }}
            />
            <Text size={1} weight="medium">Reply-To = submitter</Text>
          </Flex>
          <div style={hint}>When on, a reply to the notification goes to the person who submitted.</div>
        </Stack>

        {/* ── Save ─────────────────────────────────────────────────────── */}
        <Flex align="center" gap={3}>
          <Button text={saving ? 'Saving…' : 'Save'} tone="primary" disabled={saving || !dirty} onClick={save} />
          {saved && !dirty && <span style={{ fontSize: 13, color: '#2e7d32' }}>Saved.</span>}
          {saveError && (
            <span role="alert" style={{ fontSize: 13, color: '#c62828' }}>
              {saveError}
            </span>
          )}
        </Flex>
      </Stack>
    </Box>
  )
}
