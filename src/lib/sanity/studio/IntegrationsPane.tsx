'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useClient } from 'sanity'
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_REGISTRY,
  getIntegrationStatus,
  integrationConfigTypeName,
  integrationValuesTypeName,
  type IntegrationConfig,
  type IntegrationFieldDef,
  type IntegrationManifest,
  type IntegrationStatusValue,
  type PrivacySettings,
} from '../../integrations'

/**
 * IntegrationsPane — Project Settings > Integrations pane.
 *
 * ADR-014 Phase B, slice 2. Replaces the C1 StubPane placeholder.
 *
 * Two views, held as local navigation state (no router — mirrors how
 * DesignSystemAssignPane holds its own confirm/success sub-states):
 *   - Category index — INTEGRATION_CATEGORIES × INTEGRATION_REGISTRY, with a
 *     registry-derived "Coming soon" row for categories with no manifests.
 *   - Integration detail — enabled toggle, manifest-driven fields, and (for
 *     custom-scripts) the ADR-013-hardened script list editor.
 *
 * Data: fetches `project.integrationConfigs` + `project.privacy` once via the
 * studio client, using the same "operate directly on the published project
 * id" convention ModuleList and DesignSystemAssignPane already use — options.
 * projectId is sourced from sanity.config.ts's structure builder, which
 * already excludes drafts at the top-level client fetch (see the `clients`
 * query, `!(_id in path("drafts.**"))`). No separate draft-merge logic is
 * introduced here; Studio's own draft workflow does not apply to this
 * platform-managed, hidden array field.
 *
 * Writes: upserts one entry into `integrationConfigs` by `integrationId` via
 * `client.patch(projectId).setIfMissing(...).insert('replace', ...)` (existing
 * entry) or `.append(...)` (new entry) — never touches any other array entry.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

interface IntegrationsPaneProps {
  options?: {
    projectId?: string
    projectSlug?: string
  }
}

/** Runtime shape of a fetched integrationConfigs entry — carries Sanity's
 *  array-member bookkeeping fields that IntegrationConfig (the TS domain
 *  type in src/lib/integrations/types.ts) intentionally omits. */
interface FetchedIntegrationConfig extends IntegrationConfig {
  _key?: string
  _type?: string
}

interface ProjectIntegrationsDoc {
  integrationConfigs?: FetchedIntegrationConfig[]
  privacy?: PrivacySettings
}

type CustomScriptConsentCategory = '' | 'necessary' | 'analytics' | 'marketing' | 'functional'

interface LocalCustomScript {
  _key: string
  label: string
  description: string
  placement: 'head' | 'bodyEnd'
  code: string
  consentCategory: CustomScriptConsentCategory
  enabled: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const statusBadgeStyle = (kind: IntegrationStatusValue): React.CSSProperties => {
  const map: Record<IntegrationStatusValue, React.CSSProperties> = {
    'not-configured': { background: '#fafafa', color: '#bdbdbd', border: '1px solid #eeeeee' },
    disabled: { background: '#f5f5f5', color: '#9e9e9e', border: '1px solid #e0e0e0' },
    enabled: { background: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9' },
  }
  return {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    ...map[kind],
  }
}

const statusLabel = (kind: IntegrationStatusValue): string => {
  if (kind === 'not-configured') return 'Not configured'
  if (kind === 'disabled') return 'Disabled'
  return 'Enabled'
}

function IndicatorBadge({ tone, children }: { tone: 'warn' | 'danger'; children: React.ReactNode }) {
  const styles: Record<'warn' | 'danger', React.CSSProperties> = {
    warn: { background: '#fff8e1', color: '#8d6e00', border: '1px solid #ffe082' },
    danger: { background: '#ffebee', color: '#c62828', border: '1px solid #ef9a9a' },
  }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        marginLeft: 6,
        ...styles[tone],
      }}
    >
      {children}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IntegrationsPane({ options }: IntegrationsPaneProps) {
  const projectId = options?.projectId
  const client = useClient({ apiVersion: '2026-05-21' })

  const [doc, setDoc] = useState<ProjectIntegrationsDoc>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) {
      setLoading(false)
      return
    }
    setLoading(true)
    client
      .fetch<ProjectIntegrationsDoc>(
        `*[_type == "project" && _id == $projectId][0]{ integrationConfigs, privacy }`,
        { projectId }
      )
      .then((data) => setDoc(data ?? {}))
      .catch(() => setError('Failed to load integration configuration.'))
      .finally(() => setLoading(false))
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const configByIntegrationId = useMemo(() => {
    const map = new Map<string, FetchedIntegrationConfig>()
    for (const cfg of doc.integrationConfigs ?? []) {
      map.set(cfg.integrationId, cfg)
    }
    return map
  }, [doc.integrationConfigs])

  const handleSaved = useCallback((manifest: IntegrationManifest, entry: FetchedIntegrationConfig) => {
    setDoc((prev) => {
      const next = (prev.integrationConfigs ?? []).filter((c) => c.integrationId !== manifest.id)
      next.push(entry)
      return { ...prev, integrationConfigs: next }
    })
  }, [])

  // ── Loading / error / no-project states ─────────────────────────────────────

  if (!projectId) {
    return <div style={{ padding: 32, fontSize: 13, color: '#aaa' }}>No project selected.</div>
  }

  if (loading) {
    return <div style={{ padding: 32, fontSize: 13, color: '#aaa' }}>Loading integrations…</div>
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

  const selectedManifest = selectedId
    ? INTEGRATION_REGISTRY.find((m) => m.id === selectedId) ?? null
    : null

  if (selectedManifest) {
    return (
      <IntegrationDetail
        key={selectedManifest.id}
        manifest={selectedManifest}
        config={configByIntegrationId.get(selectedManifest.id)}
        privacy={doc.privacy}
        client={client}
        projectId={projectId}
        onBack={() => setSelectedId(null)}
        onSaved={(entry) => handleSaved(selectedManifest, entry)}
      />
    )
  }

  return (
    <CategoryIndex
      configByIntegrationId={configByIntegrationId}
      privacy={doc.privacy}
      projectSlug={options?.projectSlug}
      onSelect={setSelectedId}
    />
  )
}

// ── Category index ────────────────────────────────────────────────────────────

function CategoryIndex({
  configByIntegrationId,
  privacy,
  projectSlug,
  onSelect,
}: {
  configByIntegrationId: Map<string, FetchedIntegrationConfig>
  privacy: PrivacySettings | undefined
  projectSlug?: string
  onSelect: (id: string) => void
}) {
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
        Integrations{projectSlug ? ` — ${projectSlug}` : ''}
      </div>

      {INTEGRATION_CATEGORIES.map((category) => {
        // Registry-derived: a category with zero registered manifests is
        // "Coming soon" purely because nothing matches this filter — no
        // per-category hardcoded state (CLAUDE.md Configuration Over
        // Hardcoding; ADR-014).
        const manifests = INTEGRATION_REGISTRY.filter((m) => m.category === category.id)
        return (
          <div key={category.id} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 10 }}>
              {category.label}
            </div>

            {manifests.length === 0 ? (
              <div
                style={{
                  padding: '12px 16px',
                  fontSize: 13,
                  color: '#bbb',
                  background: '#fafafa',
                  border: '1px dashed #eeeeee',
                  borderRadius: 6,
                }}
              >
                Coming soon
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {manifests.map((manifest) => {
                  const status = getIntegrationStatus(
                    manifest,
                    configByIntegrationId.get(manifest.id),
                    privacy
                  )
                  return (
                    <button
                      key={manifest.id}
                      type="button"
                      onClick={() => onSelect(manifest.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 16px',
                        background: '#fafafa',
                        border: '1px solid #eeeeee',
                        borderRadius: 6,
                        cursor: 'pointer',
                        textAlign: 'left',
                        font: 'inherit',
                        width: '100%',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#111' }}>
                          {manifest.label}
                        </div>
                        <div style={{ fontSize: 12, color: '#bbb', fontFamily: 'monospace' }}>
                          {manifest.id}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, marginLeft: 16, display: 'flex', alignItems: 'center' }}>
                        <span style={statusBadgeStyle(status.status)}>{statusLabel(status.status)}</span>
                        {status.consentGated && <IndicatorBadge tone="warn">Consent-gated</IndicatorBadge>}
                        {status.killSwitched && (
                          <IndicatorBadge tone="danger">Kill switch active</IndicatorBadge>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Integration detail ────────────────────────────────────────────────────────

function IntegrationDetail({
  manifest,
  config,
  privacy,
  client,
  projectId,
  onBack,
  onSaved,
}: {
  manifest: IntegrationManifest
  config: FetchedIntegrationConfig | undefined
  privacy: PrivacySettings | undefined
  client: ReturnType<typeof useClient>
  projectId: string
  onBack: () => void
  onSaved: (entry: FetchedIntegrationConfig) => void
}) {
  const status = useMemo(() => getIntegrationStatus(manifest, config, privacy), [manifest, config, privacy])

  const [enabled, setEnabled] = useState<boolean>(config?.enabled === true)
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...(config?.values ?? {}) }))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [scriptErrors, setScriptErrors] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)

  const stringFields = manifest.fields.filter((f) => f.type !== 'customScriptArray')
  const arrayFields = manifest.fields.filter((f) => f.type === 'customScriptArray')

  const validateStringField = useCallback((field: IntegrationFieldDef, value: string): string | null => {
    if (field.required && value.trim() === '') return 'This field is required.'
    if (field.validation && value.trim() !== '') {
      const re = new RegExp(field.validation.regex)
      if (!re.test(value)) return field.validation.message
    }
    return null
  }, [])

  const handleStringChange = useCallback(
    (field: IntegrationFieldDef, raw: string) => {
      setValues((prev) => ({ ...prev, [field.id]: raw }))
      const err = validateStringField(field, raw)
      setFieldErrors((prev) => ({ ...prev, [field.id]: err ?? '' }))
    },
    [validateStringField]
  )

  const getScripts = useCallback(
    (field: IntegrationFieldDef): LocalCustomScript[] => {
      const raw = values[field.id]
      return Array.isArray(raw) ? (raw as LocalCustomScript[]) : []
    },
    [values]
  )

  const setScripts = useCallback((field: IntegrationFieldDef, next: LocalCustomScript[]) => {
    setValues((prev) => ({ ...prev, [field.id]: next }))
  }, [])

  const addScript = useCallback(
    (field: IntegrationFieldDef) => {
      const next: LocalCustomScript = {
        _key: generateKey('script'),
        label: '',
        description: '',
        placement: 'head',
        code: '',
        consentCategory: '', // no default — must be explicitly chosen (ADR-013)
        enabled: false, // new entries start disabled (ADR-013 hardening)
      }
      setScripts(field, [...getScripts(field), next])
    },
    [getScripts, setScripts]
  )

  const updateScript = useCallback(
    (field: IntegrationFieldDef, key: string, patch: Partial<LocalCustomScript>) => {
      setScripts(
        field,
        getScripts(field).map((s) => (s._key === key ? { ...s, ...patch } : s))
      )
    },
    [getScripts, setScripts]
  )

  const removeScript = useCallback(
    (field: IntegrationFieldDef, key: string) => {
      setScripts(field, getScripts(field).filter((s) => s._key !== key))
      setScriptErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    },
    [getScripts, setScripts]
  )

  const validateScript = (script: LocalCustomScript): Record<string, string> => {
    const errs: Record<string, string> = {}
    if (script.label.trim() === '') errs.label = 'Label is required.'
    if (script.description.trim() === '') errs.description = 'Description is required.'
    if (script.code.trim() === '') errs.code = 'Code is required.'
    if (script.consentCategory === '') errs.consentCategory = 'Consent category is required.'
    return errs
  }

  const runValidation = useCallback((): boolean => {
    let ok = true

    const nextFieldErrors: Record<string, string> = {}
    for (const field of stringFields) {
      const value = typeof values[field.id] === 'string' ? (values[field.id] as string) : ''
      const err = validateStringField(field, value)
      if (err) {
        nextFieldErrors[field.id] = err
        ok = false
      }
    }
    setFieldErrors(nextFieldErrors)

    const nextScriptErrors: Record<string, Record<string, string>> = {}
    for (const field of arrayFields) {
      for (const script of getScripts(field)) {
        const errs = validateScript(script)
        if (Object.keys(errs).length > 0) {
          nextScriptErrors[script._key] = errs
          ok = false
        }
      }
    }
    setScriptErrors(nextScriptErrors)

    return ok
  }, [stringFields, arrayFields, values, validateStringField, getScripts])

  const handleSave = useCallback(async () => {
    setSaveError(null)
    setSavedNotice(false)

    if (!runValidation()) {
      setSaveError('Fix the highlighted fields before saving.')
      return
    }

    setSaving(true)
    try {
      const configTypeName = integrationConfigTypeName(manifest)
      const valuesTypeName = integrationValuesTypeName(manifest)

      const cleanedValues: Record<string, unknown> = { _type: valuesTypeName }
      for (const field of manifest.fields) {
        if (field.type === 'customScriptArray') {
          cleanedValues[field.id] = getScripts(field).map((s) => ({
            _key: s._key,
            _type: 'customScript',
            label: s.label,
            description: s.description,
            placement: s.placement,
            code: s.code,
            consentCategory: s.consentCategory,
            enabled: s.enabled,
          }))
        } else {
          cleanedValues[field.id] = values[field.id] ?? ''
        }
      }

      const key = config?._key ?? generateKey(manifest.id)
      const entry: FetchedIntegrationConfig = {
        _type: configTypeName,
        _key: key,
        integrationId: manifest.id,
        enabled,
        values: cleanedValues,
      }

      let patch = client.patch(projectId).setIfMissing({ integrationConfigs: [] })
      if (config) {
        // Existing entry — replace only this entry, never any other.
        patch = patch.insert('replace', `integrationConfigs[integrationId=="${manifest.id}"]`, [entry])
      } else {
        // New entry — append, leaving every other entry untouched.
        patch = patch.append('integrationConfigs', [entry])
      }
      await patch.commit()

      onSaved(entry)
      setSavedNotice(true)
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [manifest, values, enabled, config, client, projectId, onSaved, getScripts, runValidation])

  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: '#888',
          fontSize: 13,
          cursor: 'pointer',
          padding: 0,
          marginBottom: 20,
        }}
      >
        ← Back to Integrations
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#111' }}>{manifest.label}</div>
        <span style={statusBadgeStyle(status.status)}>{statusLabel(status.status)}</span>
        {status.consentGated && <IndicatorBadge tone="warn">Consent-gated</IndicatorBadge>}
        {status.killSwitched && <IndicatorBadge tone="danger">Kill switch active</IndicatorBadge>}
      </div>

      {manifest.docsUrl && (
        <a
          href={manifest.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: '#1565c0' }}
        >
          View documentation →
        </a>
      )}

      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <label
          htmlFor="integration-enabled-toggle"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            fontWeight: 500,
            color: '#111',
            cursor: 'pointer',
          }}
        >
          <input
            id="integration-enabled-toggle"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          Enabled
        </label>
      </div>

      {stringFields.map((field) => {
        const value = typeof values[field.id] === 'string' ? (values[field.id] as string) : ''
        const err = fieldErrors[field.id]
        return (
          <div key={field.id} style={{ marginBottom: 20 }}>
            <label
              htmlFor={`field-${field.id}`}
              style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 500 }}
            >
              {field.label}
              {field.required ? ' *' : ''}
            </label>
            <input
              id={`field-${field.id}`}
              type="text"
              value={value}
              onChange={(e) => handleStringChange(field, e.target.value)}
              aria-invalid={!!err}
              aria-describedby={err ? `field-${field.id}-error` : undefined}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 13,
                border: `1px solid ${err ? '#ef5350' : '#d0d0d0'}`,
                borderRadius: 4,
                boxSizing: 'border-box',
              }}
            />
            {field.description && (
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{field.description}</div>
            )}
            {err && (
              <div id={`field-${field.id}-error`} role="alert" style={{ fontSize: 12, color: '#c62828', marginTop: 4 }}>
                {err}
              </div>
            )}
          </div>
        )
      })}

      {arrayFields.map((field) => (
        <CustomScriptArrayEditor
          key={field.id}
          field={field}
          scripts={getScripts(field)}
          errors={scriptErrors}
          onAdd={() => addScript(field)}
          onUpdate={(key, patch) => updateScript(field, key, patch)}
          onRemove={(key) => removeScript(field, key)}
        />
      ))}

      {/* ── Consent block (read-only) — copy is verbatim per task brief ────── */}
      <div
        style={{
          marginTop: 24,
          marginBottom: 24,
          padding: 16,
          background: '#f8f8f8',
          border: '1px solid #eeeeee',
          borderRadius: 6,
          fontSize: 13,
          color: '#666',
        }}
      >
        Consent — This integration is controlled by the global Privacy settings. Open Privacy →
      </div>

      {saveError && (
        <div role="alert" style={{ fontSize: 13, color: '#c62828', marginBottom: 12 }}>
          {saveError}
        </div>
      )}
      {savedNotice && !saveError && (
        <div role="status" style={{ fontSize: 13, color: '#2e7d32', marginBottom: 12 }}>
          Saved.
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '10px 20px',
          fontSize: 13,
          fontWeight: 500,
          background: saving ? '#999' : '#1a1a1a',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: saving ? 'default' : 'pointer',
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

// ── Custom script array editor ────────────────────────────────────────────────

function CustomScriptArrayEditor({
  field,
  scripts,
  errors,
  onAdd,
  onUpdate,
  onRemove,
}: {
  field: IntegrationFieldDef
  scripts: LocalCustomScript[]
  errors: Record<string, Record<string, string>>
  onAdd: () => void
  onUpdate: (key: string, patch: Partial<LocalCustomScript>) => void
  onRemove: (key: string) => void
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 12, color: '#666', fontWeight: 500 }}>{field.label}</div>
        <button
          type="button"
          onClick={onAdd}
          style={{
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            background: '#fff',
            border: '1px solid #d0d0d0',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          + Add script
        </button>
      </div>

      {field.description && (
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>{field.description}</div>
      )}

      {scripts.length === 0 && (
        <div style={{ fontSize: 13, color: '#bbb', padding: '12px 0' }}>No scripts added.</div>
      )}

      {scripts.map((script) => {
        const err = errors[script._key] ?? {}
        return (
          <div
            key={script._key}
            style={{
              padding: 16,
              marginBottom: 12,
              background: '#fafafa',
              border: '1px solid #eeeeee',
              borderRadius: 6,
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor={`script-${script._key}-label`}
                style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}
              >
                Label
              </label>
              <input
                id={`script-${script._key}-label`}
                type="text"
                value={script.label}
                onChange={(e) => onUpdate(script._key, { label: e.target.value })}
                aria-invalid={!!err.label}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  border: `1px solid ${err.label ? '#ef5350' : '#d0d0d0'}`,
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
              {err.label && (
                <div role="alert" style={{ fontSize: 12, color: '#c62828', marginTop: 4 }}>
                  {err.label}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor={`script-${script._key}-description`}
                style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}
              >
                Description / Purpose
              </label>
              <textarea
                id={`script-${script._key}-description`}
                value={script.description}
                onChange={(e) => onUpdate(script._key, { description: e.target.value })}
                rows={2}
                aria-invalid={!!err.description}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  border: `1px solid ${err.description ? '#ef5350' : '#d0d0d0'}`,
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
              {err.description && (
                <div role="alert" style={{ fontSize: 12, color: '#c62828', marginTop: 4 }}>
                  {err.description}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor={`script-${script._key}-placement`}
                style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}
              >
                Placement
              </label>
              <select
                id={`script-${script._key}-placement`}
                value={script.placement}
                onChange={(e) => onUpdate(script._key, { placement: e.target.value as 'head' | 'bodyEnd' })}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              >
                <option value="head">Head</option>
                <option value="bodyEnd">End of body</option>
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor={`script-${script._key}-code`}
                style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}
              >
                Code
              </label>
              <textarea
                id={`script-${script._key}-code`}
                value={script.code}
                onChange={(e) => onUpdate(script._key, { code: e.target.value })}
                rows={5}
                aria-invalid={!!err.code}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  fontFamily: 'monospace',
                  border: `1px solid ${err.code ? '#ef5350' : '#d0d0d0'}`,
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
              {err.code && (
                <div role="alert" style={{ fontSize: 12, color: '#c62828', marginTop: 4 }}>
                  {err.code}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor={`script-${script._key}-consent`}
                style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}
              >
                Consent Category
              </label>
              <select
                id={`script-${script._key}-consent`}
                value={script.consentCategory}
                onChange={(e) =>
                  onUpdate(script._key, { consentCategory: e.target.value as CustomScriptConsentCategory })
                }
                aria-invalid={!!err.consentCategory}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  border: `1px solid ${err.consentCategory ? '#ef5350' : '#d0d0d0'}`,
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              >
                <option value="">— Select —</option>
                <option value="necessary">Necessary</option>
                <option value="analytics">Analytics</option>
                <option value="marketing">Marketing</option>
                <option value="functional">Functional</option>
              </select>
              {err.consentCategory && (
                <div role="alert" style={{ fontSize: 12, color: '#c62828', marginTop: 4 }}>
                  {err.consentCategory}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label
                htmlFor={`script-${script._key}-enabled`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}
              >
                <input
                  id={`script-${script._key}-enabled`}
                  type="checkbox"
                  checked={script.enabled}
                  onChange={(e) => onUpdate(script._key, { enabled: e.target.checked })}
                  style={{ width: 16, height: 16 }}
                />
                Enabled
              </label>
              <button
                type="button"
                onClick={() => onRemove(script._key)}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  color: '#c62828',
                  background: '#fff',
                  border: '1px solid #ef9a9a',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
