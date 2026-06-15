// ─── Design System Export / Import — shared utilities ────────────────────────

// Sanity metadata fields to strip on export.
// TODO (future): handle image/asset references explicitly — currently exported
// as Sanity asset reference objects. When marketplace/sharing features land,
// these will need to be resolved to URLs or omitted entirely.
const METADATA_KEYS = new Set(['_id', '_rev', '_createdAt', '_updatedAt', '_type'])

export const SCHEMA_VERSION = 1

export type DesignSystemExportPayload = {
  schemaVersion: number
  exportedAt: string
  designSystem: Record<string, unknown>
}

// ── Strip Sanity metadata, return only portable fields ────────────────────────

export function stripMetadata(doc: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(doc).filter(([key]) => !METADATA_KEYS.has(key))
  )
}

// ── Build the export envelope ─────────────────────────────────────────────────

export function buildExportPayload(doc: Record<string, unknown>): DesignSystemExportPayload {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    designSystem: stripMetadata(doc),
  }
}

// ── Validate imported JSON ────────────────────────────────────────────────────

export type ValidationResult =
  | { valid: true; data: Record<string, unknown>; schemaVersion?: number }
  | { valid: false; error: string }

export function validateImport(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, error: 'Invalid file — expected a JSON object at the root' }
  }
  const obj = raw as Record<string, unknown>

  if (!('designSystem' in obj)) {
    return { valid: false, error: 'Invalid file — missing required "designSystem" key' }
  }
  if (typeof obj.designSystem !== 'object' || obj.designSystem === null || Array.isArray(obj.designSystem)) {
    return { valid: false, error: 'Invalid file — "designSystem" must be a non-null object' }
  }

  const schemaVersion =
    typeof obj.schemaVersion === 'number' ? obj.schemaVersion : undefined

  return {
    valid: true,
    data: obj.designSystem as Record<string, unknown>,
    schemaVersion,
  }
}

// ── Trigger a JSON file download ──────────────────────────────────────────────

export function downloadJson(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

// ── Derive a filename from the design system document ─────────────────────────

export function exportFilename(doc: Record<string, unknown>): string {
  const slug =
    (doc.projectSlug as string | undefined) ??
    (doc.name as string | undefined)?.toLowerCase().replace(/\s+/g, '-') ??
    'untitled'
  return `design-system-${slug}.json`
}
