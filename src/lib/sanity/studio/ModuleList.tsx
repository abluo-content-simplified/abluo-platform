'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useClient } from 'sanity'
import { MODULE_REGISTRY } from '../../modules'
import { moduleInstallationTypeNameForId, moduleConfigTypeName } from '../../modules/config-schema'
import type {
  ModuleConfigFieldDef,
  ModuleManifest,
  ModulePlacementSurface,
} from '../../modules/types'

/**
 * ModuleList — the Modules pane. ADR-020 Decision 1.
 *
 * Replaces the read-only ADR-011 Phase C1 display. Every module now opens with
 * the same four-part shape, whatever the module is:
 *
 *   Status        — active / inactive for this website, written to
 *                   project.moduleInstallations[].enabled
 *   Placement     — where the module surfaces. Derived from the manifest
 *                   (page / sections) and therefore read-only; the one
 *                   genuinely per-site placement decision, a site-wide toggle,
 *                   is rendered as the boolean config field it actually is.
 *   Configuration — manifest-driven controls generated from configSchema
 *   Data          — what the module produces, and in which store
 *
 * A module carries a version: `version` on the installation record is the
 * manifest version at install time, deliberately NOT the live registry version.
 * When they diverge the pane says so, because that difference is the whole
 * point of versioning — a site keeps running the version it was installed with
 * until an admin updates it.
 *
 * Data source / write model
 * -------------------------
 * Reads and writes `project.moduleInstallations` on the PUBLISHED project
 * document, the same convention IntegrationsPane and DesignSystemAssignPane
 * use: options.projectId comes from sanity.config.ts's structure builder, whose
 * top-level client fetch already excludes drafts. moduleInstallations is a
 * hidden, platform-managed array — Studio's draft/publish workflow does not
 * apply to it, so there is no draft-merge step here.
 *
 * Writes target a single array entry by moduleId and never rewrite the whole
 * array: `.insert('replace', 'moduleInstallations[moduleId=="x"]', [entry])`
 * for an existing record, `.append(...)` for a new one. Two admins editing two
 * different modules therefore cannot clobber each other.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

interface ModuleListProps {
  options?: {
    projectId?: string
    projectSlug?: string
  }
}

/** Runtime shape of a fetched moduleInstallations entry. Carries Sanity's array
 *  bookkeeping fields that the ModuleInstallation domain type omits. */
interface FetchedInstallation {
  _key?: string
  _type?: string
  moduleId: string
  version?: string
  enabled?: boolean
  installedAt?: string
  provenance?: 'admin' | 'auto'
  config?: Record<string, unknown>
}

/** A Sanity reference value as stored in a config field. */
interface ReferenceValue {
  _type: 'reference'
  _ref: string
}

/** Minimal projection of a document offered in a reference picker. */
interface ReferenceOption {
  _id: string
  label: string
}

type StatusKind = 'active' | 'inactive' | 'not-installed'

// ── Styles ─────────────────────────────────────────────────────────────────────

const badgeStyle = (kind: StatusKind): React.CSSProperties => {
  const map: Record<StatusKind, React.CSSProperties> = {
    active: { background: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9' },
    inactive: { background: '#f5f5f5', color: '#9e9e9e', border: '1px solid #e0e0e0' },
    'not-installed': { background: '#fafafa', color: '#bdbdbd', border: '1px solid #eeeeee' },
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

const statusLabel = (kind: StatusKind): string => {
  if (kind === 'active') return 'Active'
  if (kind === 'inactive') return 'Inactive'
  return 'Available'
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 13,
  border: '1px solid #d0d0d0',
  borderRadius: 4,
  boxSizing: 'border-box',
}

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#999',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 12,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateKey(moduleId: string): string {
  // Matches the stable key convention used by migration 004: one installation
  // per module per project, so the module id alone is unique in the array.
  return `module-${moduleId}`
}

function statusOf(inst: FetchedInstallation | undefined): StatusKind {
  if (!inst) return 'not-installed'
  return inst.enabled === false ? 'inactive' : 'active'
}

function isReferenceValue(v: unknown): v is ReferenceValue {
  return typeof v === 'object' && v !== null && '_ref' in v
}

/** Human summary of what a module stores and where. */
function dataStoreLabel(manifest: ModuleManifest): string {
  switch (manifest.dataStore.primary) {
    case 'content':
      return 'Editorial content, stored in the CMS.'
    case 'operational':
      return 'Operational records, stored in the platform database.'
    case 'hybrid':
      return 'Editorial content in the CMS, plus operational records in the platform database.'
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModuleList({ options }: ModuleListProps) {
  const projectId = options?.projectId
  const projectSlug = options?.projectSlug
  const client = useClient({ apiVersion: '2026-05-21' })

  const [installations, setInstallations] = useState<FetchedInstallation[]>([])
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
      .fetch<FetchedInstallation[] | null>(
        `*[_type == "project" && _id == $projectId][0].moduleInstallations[] {
          _key, _type, moduleId, version, enabled, installedAt, provenance, config
        }`,
        { projectId }
      )
      .then((data) => setInstallations(data ?? []))
      .catch(() => setError('Failed to load modules.'))
      .finally(() => setLoading(false))
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const byModuleId = useMemo(() => {
    const map = new Map<string, FetchedInstallation>()
    for (const inst of installations) map.set(inst.moduleId, inst)
    return map
  }, [installations])

  const handleSaved = useCallback((entry: FetchedInstallation) => {
    setInstallations((prev) => [...prev.filter((i) => i.moduleId !== entry.moduleId), entry])
  }, [])

  if (!projectId) {
    return <div style={{ padding: 32, fontSize: 13, color: '#aaa' }}>No website selected.</div>
  }

  if (loading) {
    return <div style={{ padding: 32, fontSize: 13, color: '#aaa' }}>Loading modules…</div>
  }

  if (error) {
    return (
      <div
        role="alert"
        style={{
          padding: 32,
          margin: 32,
          fontSize: 13,
          color: '#c62828',
          background: '#ffebee',
          borderRadius: 4,
        }}
      >
        {error}
      </div>
    )
  }

  const selectedManifest = selectedId
    ? MODULE_REGISTRY.find((m) => m.id === selectedId) ?? null
    : null

  if (selectedManifest) {
    return (
      <ModuleDetail
        key={selectedManifest.id}
        manifest={selectedManifest}
        installation={byModuleId.get(selectedManifest.id)}
        client={client}
        projectId={projectId}
        onBack={() => setSelectedId(null)}
        onSaved={handleSaved}
      />
    )
  }

  return (
    <ModuleIndex
      byModuleId={byModuleId}
      projectSlug={projectSlug}
      onSelect={setSelectedId}
    />
  )
}

// ── Index ──────────────────────────────────────────────────────────────────────

function ModuleIndex({
  byModuleId,
  projectSlug,
  onSelect,
}: {
  byModuleId: Map<string, FetchedInstallation>
  projectSlug?: string
  onSelect: (id: string) => void
}) {
  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <div style={sectionHeadingStyle}>Modules{projectSlug ? ` — ${projectSlug}` : ''}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Every registered module appears for every website. A new module is
            available-but-inactive everywhere the moment it is registered —
            ADR-020: "New modules appear in every site's list as
            available-but-inactive." Nothing here is gated by tenant. */}
        {MODULE_REGISTRY.map((manifest) => {
          const inst = byModuleId.get(manifest.id)
          const status = statusOf(inst)
          const isOn = status === 'active'

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
                <div style={{ fontSize: 14, fontWeight: 500, color: isOn ? '#111' : '#888' }}>
                  {manifest.label}
                </div>
                <div style={{ fontSize: 12, color: '#bbb', fontFamily: 'monospace' }}>
                  {manifest.id}
                  {inst?.version ? ` · v${inst.version}` : ''}
                  {inst?.provenance === 'auto' ? ' · migrated' : ''}
                </div>
              </div>
              <div style={{ flexShrink: 0, marginLeft: 16 }}>
                <span style={badgeStyle(status)}>{statusLabel(status)}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Detail ─────────────────────────────────────────────────────────────────────

function ModuleDetail({
  manifest,
  installation,
  client,
  projectId,
  onBack,
  onSaved,
}: {
  manifest: ModuleManifest
  installation: FetchedInstallation | undefined
  client: ReturnType<typeof useClient>
  projectId: string
  onBack: () => void
  onSaved: (entry: FetchedInstallation) => void
}) {
  const configSchema = manifest.platformContract.configSchema

  const [enabled, setEnabled] = useState<boolean>(
    installation ? installation.enabled !== false : false
  )
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = { ...(installation?.config ?? {}) }
    // Seed declared defaults for fields the stored config has never carried,
    // so a freshly-activated module starts in the state its manifest describes
    // rather than with empty controls.
    for (const field of configSchema) {
      if (initial[field.id] === undefined && field.initialValue !== undefined) {
        initial[field.id] = field.initialValue
      }
    }
    return initial
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)

  const status = statusOf(installation)
  const registryVersion = manifest.version
  const installedVersion = installation?.version
  const versionDrift = !!installedVersion && installedVersion !== registryVersion

  const validateField = useCallback(
    (field: ModuleConfigFieldDef, value: unknown): string | null => {
      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '')

      if (field.required && isEmpty) return 'This field is required.'
      if (field.validation && typeof value === 'string' && value.trim() !== '') {
        if (!new RegExp(field.validation.regex).test(value)) return field.validation.message
      }
      return null
    },
    []
  )

  const handleChange = useCallback(
    (field: ModuleConfigFieldDef, value: unknown) => {
      setValues((prev) => ({ ...prev, [field.id]: value }))
      setFieldErrors((prev) => ({ ...prev, [field.id]: validateField(field, value) ?? '' }))
    },
    [validateField]
  )

  const handleSave = useCallback(async () => {
    setSaveError(null)
    setSavedNotice(false)

    // Validate config only when the module is on. An inactive module's config
    // is not in force, so blocking deactivation on an incomplete field would
    // trap an admin in exactly the state they are trying to leave.
    if (enabled) {
      const errs: Record<string, string> = {}
      for (const field of configSchema) {
        const err = validateField(field, values[field.id])
        if (err) errs[field.id] = err
      }
      setFieldErrors(errs)
      if (Object.keys(errs).length > 0) {
        setSaveError('Fix the highlighted fields before saving.')
        return
      }
    }

    const installationType = moduleInstallationTypeNameForId(manifest.id)
    if (!installationType) {
      // Unreachable via the UI — the list only renders registered modules —
      // but writing an entry with an unresolvable _type would corrupt the array.
      setSaveError('This module is not in the registry and cannot be installed.')
      return
    }

    setSaving(true)
    try {
      const config: Record<string, unknown> = { _type: moduleConfigTypeName(manifest) }
      for (const field of configSchema) {
        const value = values[field.id]
        // Omit empty optional values rather than storing empty strings — an
        // unset reference must be absent, not a malformed reference object.
        if (value === undefined || value === null || value === '') continue
        config[field.id] = value
      }

      const entry: FetchedInstallation = {
        _type: installationType,
        _key: installation?._key ?? generateKey(manifest.id),
        moduleId: manifest.id,
        // First activation stamps the current registry version. A module
        // already installed keeps the version it was installed with — updating
        // to a newer manifest version is a separate, deliberate action.
        version: installedVersion ?? registryVersion,
        enabled,
        installedAt: installation?.installedAt ?? new Date().toISOString(),
        provenance: installation?.provenance ?? 'admin',
        config,
      }

      let patch = client.patch(projectId).setIfMissing({ moduleInstallations: [] })
      if (installation) {
        patch = patch.insert(
          'replace',
          `moduleInstallations[moduleId=="${manifest.id}"]`,
          [entry]
        )
      } else {
        patch = patch.append('moduleInstallations', [entry])
      }
      await patch.commit()

      onSaved(entry)
      setSavedNotice(true)
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [
    manifest,
    configSchema,
    values,
    enabled,
    installation,
    installedVersion,
    registryVersion,
    client,
    projectId,
    onSaved,
    validateField,
  ])

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
        ← Back to Modules
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#111' }}>{manifest.label}</div>
        <span style={badgeStyle(status)}>{statusLabel(status)}</span>
      </div>

      <div style={{ fontSize: 12, color: '#bbb', fontFamily: 'monospace', marginBottom: 28 }}>
        {manifest.id} · v{installedVersion ?? registryVersion}
        {versionDrift ? ` · registry has v${registryVersion}` : ''}
      </div>

      {versionDrift && (
        <div
          style={{
            padding: 12,
            marginBottom: 24,
            fontSize: 13,
            color: '#8d6e00',
            background: '#fff8e1',
            border: '1px solid #ffe082',
            borderRadius: 6,
          }}
        >
          This website runs version {installedVersion} of the module. Version {registryVersion} is
          available. Content keeps working on the installed version until the module is updated.
        </div>
      )}

      {/* ── Status ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionHeadingStyle}>Status</div>
        <label
          htmlFor="module-enabled-toggle"
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
            id="module-enabled-toggle"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          Active on this website
        </label>
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>
          Turning a module off hides its pages, collections, and sections from this website. Its
          content is kept and returns unchanged when the module is turned back on.
        </div>
      </div>

      {/* ── Placement ───────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionHeadingStyle}>Placement</div>
        <PlacementList surfaces={manifest.platformContract.placement.surfaces} />
        {manifest.platformContract.placement.note && (
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 10 }}>
            {manifest.platformContract.placement.note}
          </div>
        )}
      </div>

      {/* ── Configuration ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionHeadingStyle}>Configuration</div>
        {configSchema.length === 0 ? (
          <div style={{ fontSize: 13, color: '#bbb' }}>
            This module has no settings — everything it does is controlled by its content.
          </div>
        ) : (
          configSchema.map((field) => (
            <ConfigField
              key={field.id}
              field={field}
              value={values[field.id]}
              error={fieldErrors[field.id]}
              client={client}
              onChange={(v) => handleChange(field, v)}
            />
          ))
        )}
      </div>

      {/* ── Data ────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionHeadingStyle}>Data</div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
          {dataStoreLabel(manifest)}
        </div>
        {manifest.platformContract.collections.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#666' }}>
            {manifest.platformContract.collections.flatMap((group) =>
              group.items.map((item) => <li key={`${group.id}-${item.id}`}>{item.label}</li>)
            )}
          </ul>
        )}
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

// ── Placement list ─────────────────────────────────────────────────────────────

/**
 * Renders placement surfaces as read-only facts.
 *
 * These are derived from the manifest, not stored per site, because they
 * already have a single source of truth elsewhere: a module's page IS its
 * pageType, and where a section appears IS the page's sections[] array.
 * Duplicating either here would create a second copy that immediately drifts.
 */
function PlacementList({ surfaces }: { surfaces: ModulePlacementSurface[] }) {
  if (surfaces.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#bbb' }}>
        This module has no website surface of its own.
      </div>
    )
  }

  const kindLabel: Record<ModulePlacementSurface['kind'], string> = {
    page: 'Page',
    sections: 'Sections',
    siteWide: 'Site-wide',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {surfaces.map((surface) => (
        <div
          key={surface.kind}
          style={{
            padding: '10px 14px',
            background: '#fafafa',
            border: '1px solid #eeeeee',
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 2 }}>
            {kindLabel[surface.kind]}
          </div>
          <div style={{ fontSize: 13, color: '#666' }}>{surface.description}</div>
        </div>
      ))}
    </div>
  )
}

// ── Config field ───────────────────────────────────────────────────────────────

function ConfigField({
  field,
  value,
  error,
  client,
  onChange,
}: {
  field: ModuleConfigFieldDef
  value: unknown
  error?: string
  client: ReturnType<typeof useClient>
  onChange: (value: unknown) => void
}) {
  const inputId = `module-config-${field.id}`
  const errorId = `${inputId}-error`

  const describedBy = error ? errorId : undefined
  const borderColor = error ? '#ef5350' : '#d0d0d0'

  return (
    <div style={{ marginBottom: 20 }}>
      {field.type === 'boolean' ? (
        <label
          htmlFor={inputId}
          style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}
        >
          <input
            id={inputId}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          {field.label}
        </label>
      ) : (
        <>
          <label
            htmlFor={inputId}
            style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 500 }}
          >
            {field.label}
            {field.required ? ' *' : ''}
          </label>

          {field.type === 'reference' ? (
            <ReferenceSelect
              inputId={inputId}
              field={field}
              value={isReferenceValue(value) ? value._ref : ''}
              describedBy={describedBy}
              invalid={!!error}
              client={client}
              onChange={(ref) =>
                onChange(ref ? { _type: 'reference', _ref: ref } : undefined)
              }
            />
          ) : field.type === 'text' ? (
            <textarea
              id={inputId}
              rows={3}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={describedBy}
              style={{ ...inputStyle, fontFamily: 'inherit', borderColor }}
            />
          ) : field.type === 'number' ? (
            <input
              id={inputId}
              type="number"
              value={typeof value === 'number' ? value : ''}
              onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
              aria-invalid={!!error}
              aria-describedby={describedBy}
              style={{ ...inputStyle, borderColor }}
            />
          ) : (
            // string and localizedString.
            //
            // localizedString is intentionally NOT edited here. It is a
            // per-locale object whose editor is LocalizedInput, and the set of
            // locales is per-website (siteConfig.supportedLocales), which this
            // pane does not resolve. Rendering a single text box would silently
            // write a bare string into a localized field and break the schema
            // contract, so a localized config field is surfaced as read-only
            // with a pointer to where it is edited. No module declares one yet;
            // this branch exists so that adding one fails visibly, not silently.
            <input
              id={inputId}
              type="text"
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
              readOnly={field.type === 'localizedString'}
              aria-invalid={!!error}
              aria-describedby={describedBy}
              style={{
                ...inputStyle,
                borderColor,
                background: field.type === 'localizedString' ? '#f5f5f5' : undefined,
              }}
            />
          )}
        </>
      )}

      {field.description && (
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{field.description}</div>
      )}
      {field.type === 'localizedString' && (
        <div style={{ fontSize: 12, color: '#8d6e00', marginTop: 4 }}>
          Translated text is edited in the document itself, not here.
        </div>
      )}
      {error && (
        <div id={errorId} role="alert" style={{ fontSize: 12, color: '#c62828', marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  )
}

// ── Reference select ───────────────────────────────────────────────────────────

/**
 * A native <select> over the documents a reference config field may point at.
 *
 * The option list is fetched from the field's own declaration — `referenceTo`
 * plus the optional `referenceFilter` — so a new reference config field needs
 * no change here. The label projection coalesces the naming fields used across
 * the platform's document types, falling back to the id.
 */
function ReferenceSelect({
  inputId,
  field,
  value,
  describedBy,
  invalid,
  client,
  onChange,
}: {
  inputId: string
  field: ModuleConfigFieldDef
  value: string
  describedBy?: string
  invalid: boolean
  client: ReturnType<typeof useClient>
  onChange: (ref: string) => void
}) {
  const [choices, setChoices] = useState<ReferenceOption[]>([])
  const [loading, setLoading] = useState(true)

  const types = useMemo(() => field.referenceTo ?? [], [field.referenceTo])
  const filter = field.referenceFilter

  useEffect(() => {
    if (types.length === 0) {
      setLoading(false)
      return
    }
    const typeClause = `_type in $types`
    const extra = filter ? ` && (${filter})` : ''
    client
      .fetch<ReferenceOption[]>(
        `*[${typeClause}${extra} && !(_id in path("drafts.**"))] | order(_createdAt asc) {
          _id,
          "label": coalesce(internalName, title, name, formId, _id)
        }`,
        { types }
      )
      .then((data) => setChoices(data ?? []))
      .catch(() => setChoices([]))
      .finally(() => setLoading(false))
  }, [types, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <select
      id={inputId}
      value={value}
      disabled={loading}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      style={{ ...inputStyle, borderColor: invalid ? '#ef5350' : '#d0d0d0' }}
    >
      <option value="">{loading ? 'Loading…' : '— None —'}</option>
      {choices.map((choice) => (
        <option key={choice._id} value={choice._id}>
          {choice.label}
        </option>
      ))}
    </select>
  )
}
