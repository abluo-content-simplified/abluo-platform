/**
 * Pure rules for AttachmentPicker: which of the picked files are kept.
 * No DOM — the same checks run in the tests.
 */
export type PickableFile = { name: string; size: number; type: string }

export type PickProblem = { kind: 'type' | 'size' | 'count' | 'total'; name: string }

export type PickRules = {
  /** Most files in the list. */
  max: number
  /** Largest single file, in bytes. */
  maxBytes: number
  /** Accepted MIME types. */
  accept: readonly string[]
  /** Optional ceiling for all files together (e.g. the server-action body limit). */
  totalBytesMax?: number
}

const EXT_TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

/** A file's type; some phones leave `type` empty, so fall back on the extension. */
export function pickedType(file: PickableFile): string {
  if (file.type) return file.type.toLowerCase()
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TYPE[ext] ?? ''
}

/** Adds `picked` to `current`, keeping what fits the rules and reporting what it left out. */
export function mergePickedFiles<T extends PickableFile>(current: T[], picked: T[], rules: PickRules): { files: T[]; problems: PickProblem[] } {
  const files = [...current]
  const problems: PickProblem[] = []
  let total = files.reduce((n, f) => n + f.size, 0)
  for (const f of picked) {
    if (!rules.accept.includes(pickedType(f))) problems.push({ kind: 'type', name: f.name })
    else if (f.size > rules.maxBytes) problems.push({ kind: 'size', name: f.name })
    else if (files.length >= rules.max) problems.push({ kind: 'count', name: f.name })
    else if (rules.totalBytesMax !== undefined && total + f.size > rules.totalBytesMax) problems.push({ kind: 'total', name: f.name })
    else {
      files.push(f)
      total += f.size
    }
  }
  return { files, problems }
}
