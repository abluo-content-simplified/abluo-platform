/** A project's name: one line, collapsed spaces, 2–60 characters (Tom, 2026-11-11). Pure; null when unusable. */
export const PROJECT_NAME_MAX = 60

export function cleanProjectName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const v = input.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return v.length >= 2 && v.length <= PROJECT_NAME_MAX ? v : null
}
