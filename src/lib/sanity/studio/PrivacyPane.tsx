'use client'

import { useCallback, useEffect, useState } from 'react'
import { useClient } from 'sanity'
import type { PrivacySettings } from '../../integrations'
import { deriveConsentPolicy, detectSiteEmbedVendors, type ConsentPurpose, type ConsentVendor, type SiteEmbedsData } from '../../consent'
import { siteEmbedsQuery } from '../queries'
import { getMapsEmbedKey } from '../../maps/provider'
import type { ProjectIntegrations } from '../types'

/**
 * PrivacyPane — Project Settings > Privacy pane.
 *
 * ADR-014 Phase B, slice 2. New listItem (Integrations' sibling) — reads and
 * writes `project.privacy` { consentModeEnabled, trackingKillSwitch }.
 *
 * Mirrors IntegrationsPane's data-fetch/patch conventions: fetches once via
 * the studio client against the published project id (options.projectId,
 * already draft-excluded upstream — see IntegrationsPane's header comment),
 * and patches `project.privacy` directly. Each switch commits immediately on
 * toggle (no separate Save step) — a deliberate low-friction choice for a
 * two-field settings pane; flagged as an `AI decides` design choice in the
 * handoff since the brief did not specify save-button vs. auto-commit.
 *
 * ADR-021 — the cookie banner is DERIVED from the enabled integrations, so the
 * old "Consent Mode Enabled" switch is gone (consent is always enforced). The
 * pane now shows why the banner is on or off, and picks the cookie-policy page
 * the banner links to. The reference is weak so a page that is still a draft
 * can be chosen: the link stays hidden until that page is published.
 */

interface PrivacyPaneProps {
  options?: {
    projectId?: string
    projectSlug?: string
  }
}

interface ProjectPrivacyDoc {
  privacy?: PrivacySettings & { cookiePolicyPage?: { _ref?: string } }
  integrationConfigs?: ProjectIntegrations['integrationConfigs']
  pages?: { _id: string; title?: string; slug?: string }[]
}

const PURPOSE_LABEL: Record<ConsentPurpose, string> = {
  analytics: 'Statistics',
  marketing: 'Marketing',
  functional: 'Functional',
  externalContent: 'External content',
}

export function PrivacyPane({ options }: PrivacyPaneProps) {
  const projectId = options?.projectId
  const client = useClient({ apiVersion: '2026-05-21' })

  const [privacy, setPrivacy] = useState<PrivacySettings>({})
  const [doc, setDoc] = useState<ProjectPrivacyDoc | null>(null)
  const [policyRef, setPolicyRef] = useState<string>('')
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [loading, setLoading] = useState(true)
  // ADR-021 amendment 2026-10-05 — embeds in the site's sections also turn the banner on.
  const [embedVendors, setEmbedVendors] = useState<ConsentVendor[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<'consentModeEnabled' | 'trackingKillSwitch' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) {
      setLoading(false)
      return
    }
    setLoading(true)
    client
      .fetch<ProjectPrivacyDoc>(
        `*[_type == "project" && _id == $projectId][0]{
          privacy,
          integrationConfigs[] { integrationId, enabled, values },
          "pages": *[_type == "page" && projectSlug == ^.projectSlug] | order(_updatedAt desc) {
            _id,
            "title": coalesce(title.en, title.it, title.de, title.fr, title.es, title.pt, title.nl),
            "slug": coalesce(slug.en.current, slug.it.current, slug.de.current, slug.fr.current, slug.es.current, slug.pt.current, slug.nl.current)
          }
        }`,
        { projectId }
      )
      .then((data) => {
        setDoc(data ?? null)
        setPrivacy(data?.privacy ?? {})
        setPolicyRef(data?.privacy?.cookiePolicyPage?._ref ?? '')
      })
      .catch(() => setError('Failed to load privacy settings.'))
      .finally(() => setLoading(false))
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const projectSlug = options?.projectSlug
    if (!projectSlug) return
    client
      .fetch<SiteEmbedsData>(siteEmbedsQuery, { projectSlug })
      .then((data) => setEmbedVendors(detectSiteEmbedVendors(data, { mapsEmbedEnabled: getMapsEmbedKey() !== null })))
      .catch(() => setEmbedVendors([]))
  }, [options?.projectSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(
    async (key: 'consentModeEnabled' | 'trackingKillSwitch', value: boolean) => {
      if (!projectId) return
      setSaveError(null)
      setSaving(key)
      const prev = privacy
      setPrivacy((p) => ({ ...p, [key]: value }))
      try {
        await client
          .patch(projectId)
          .setIfMissing({ privacy: {} })
          .set({ [`privacy.${key}`]: value })
          .commit()
      } catch {
        setPrivacy(prev)
        setSaveError('Failed to save. Please try again.')
      } finally {
        setSaving(null)
      }
    },
    [projectId, privacy, client]
  )

  const savePolicyPage = useCallback(
    async (ref: string) => {
      if (!projectId) return
      setSaveError(null)
      setSavingPolicy(true)
      const prev = policyRef
      setPolicyRef(ref)
      try {
        const patch = client.patch(projectId).setIfMissing({ privacy: {} })
        await (ref
          ? patch.set({ 'privacy.cookiePolicyPage': { _type: 'reference', _ref: ref, _weak: true } })
          : patch.unset(['privacy.cookiePolicyPage'])
        ).commit()
      } catch {
        setPolicyRef(prev)
        setSaveError('Failed to save. Please try again.')
      } finally {
        setSavingPolicy(false)
      }
    },
    [projectId, policyRef, client]
  )

  // ── Loading / error / no-project states ─────────────────────────────────────

  if (!projectId) {
    return <div style={{ padding: 32, fontSize: 13, color: '#aaa' }}>No project selected.</div>
  }

  if (loading) {
    return <div style={{ padding: 32, fontSize: 13, color: '#aaa' }}>Loading privacy settings…</div>
  }

  if (error) {
    return (
      <div
        style={{
          padding: 32,
          fontSize: 13,
          color: '#c62828',
          background: '#ffebee',
          borderRadius: 4,
          margin: 32,
        }}
      >
        {error}
      </div>
    )
  }

  const killSwitchOn = privacy.trackingKillSwitch === true

  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#999',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 20,
        }}
      >
        Privacy{options?.projectSlug ? ` — ${options.projectSlug}` : ''}
      </div>

      {killSwitchOn && (
        <div
          role="alert"
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            background: '#fff8e1',
            border: '1px solid #ffe082',
            borderRadius: 6,
            fontSize: 13,
            color: '#8d6e00',
            fontWeight: 500,
          }}
        >
          Tracking kill switch is ON — all tracking is halted for this project, regardless of any
          individual integration&rsquo;s enabled state.
        </div>
      )}

      {saveError && (
        <div role="alert" style={{ fontSize: 13, color: '#c62828', marginBottom: 16 }}>
          {saveError}
        </div>
      )}

      {/* ── Cookie banner status (ADR-021 — derived, not configured) ────────── */}
      {(() => {
        const policy = deriveConsentPolicy({ integrationConfigs: doc?.integrationConfigs, privacy }, embedVendors)
        const purposes = (Object.keys(policy.purposes) as ConsentPurpose[]).map(
          (p) => `${policy.purposes[p]!.vendors.map((v) => v.name).join(', ')} (${PURPOSE_LABEL[p]})`
        )
        // Pages keep one entry per document: a draft-only page appears once, marked.
        const pages = new Map<string, { title: string; draftOnly: boolean }>()
        for (const pg of doc?.pages ?? []) {
          const id = pg._id.replace(/^drafts\./, '')
          const isDraft = pg._id.startsWith('drafts.')
          const prev = pages.get(id)
          pages.set(id, {
            title: `${pg.title ?? 'Untitled'}${pg.slug ? ` — /${pg.slug}` : ''}`,
            draftOnly: prev ? prev.draftOnly && isDraft : isDraft,
          })
        }
        return (
          <div style={{ marginBottom: 20, padding: 16, background: '#fafafa', border: '1px solid #eeeeee', borderRadius: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#111' }}>
              Cookie banner: {purposes.length ? 'active' : 'not needed'}
            </div>
            <div style={{ fontSize: 13, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
              {purposes.length
                ? `Shown to visitors because this site uses ${purposes.join(' and ')}. It turns on and off by itself from the Integrations above — there is no switch.`
                : 'No enabled integration needs consent, so visitors see no banner. Embedded maps and videos ask for consent on their own when clicked.'}
            </div>

            <label htmlFor="privacy-cookie-policy" style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#111', marginTop: 16 }}>
              Cookie policy page
            </label>
            <select
              id="privacy-cookie-policy"
              value={policyRef}
              disabled={savingPolicy}
              onChange={(e) => savePolicyPage(e.target.value)}
              style={{ marginTop: 6, width: '100%', padding: '6px 8px', fontSize: 13 }}
            >
              <option value="">— none —</option>
              {[...pages.entries()].map(([id, pg]) => (
                <option key={id} value={id}>
                  {pg.title}{pg.draftOnly ? ' (not published yet)' : ''}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: '#888', marginTop: 6, lineHeight: 1.5 }}>
              Linked from the banner. A page that is not published yet can be chosen now — the link appears when the page is published.
            </div>
          </div>
        )
      })()}

      {/* ── Tracking Kill Switch ─────────────────────────────────────────────── */}
      <div
        style={{
          marginBottom: 20,
          padding: 16,
          background: '#fafafa',
          border: '1px solid #eeeeee',
          borderRadius: 6,
        }}
      >
        <label
          htmlFor="privacy-kill-switch"
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
        >
          <input
            id="privacy-kill-switch"
            type="checkbox"
            checked={killSwitchOn}
            disabled={saving === 'trackingKillSwitch'}
            onChange={(e) => toggle('trackingKillSwitch', e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: 14, fontWeight: 500, color: '#111' }}>Tracking Kill Switch</span>
        </label>
        <div style={{ fontSize: 13, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
          Emergency override. When on, halts ALL tracking for this project — every integration and
          custom script — regardless of each integration&rsquo;s individual enabled state or consent
          category.
        </div>
      </div>
    </div>
  )
}
