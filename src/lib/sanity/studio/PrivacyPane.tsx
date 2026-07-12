'use client'

import { useCallback, useEffect, useState } from 'react'
import { useClient } from 'sanity'
import type { PrivacySettings } from '../../integrations'

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
 */

interface PrivacyPaneProps {
  options?: {
    projectId?: string
    projectSlug?: string
  }
}

interface ProjectPrivacyDoc {
  privacy?: PrivacySettings
}

export function PrivacyPane({ options }: PrivacyPaneProps) {
  const projectId = options?.projectId
  const client = useClient({ apiVersion: '2026-05-21' })

  const [privacy, setPrivacy] = useState<PrivacySettings>({})
  const [loading, setLoading] = useState(true)
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
      .fetch<ProjectPrivacyDoc>(`*[_type == "project" && _id == $projectId][0]{ privacy }`, {
        projectId,
      })
      .then((data) => setPrivacy(data?.privacy ?? {}))
      .catch(() => setError('Failed to load privacy settings.'))
      .finally(() => setLoading(false))
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* ── Consent Mode ─────────────────────────────────────────────────────── */}
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
          htmlFor="privacy-consent-mode"
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
        >
          <input
            id="privacy-consent-mode"
            type="checkbox"
            checked={privacy.consentModeEnabled === true}
            disabled={saving === 'consentModeEnabled'}
            onChange={(e) => toggle('consentModeEnabled', e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: 14, fontWeight: 500, color: '#111' }}>Consent Mode Enabled</span>
        </label>
        <div style={{ fontSize: 13, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
          Fail-closed consent gate. When on and no valid visitor consent exists, ALL tracking is
          blocked except Necessary custom scripts — Analytics, Marketing, and Functional
          integrations and scripts do not load until consent is given.
        </div>
      </div>

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
