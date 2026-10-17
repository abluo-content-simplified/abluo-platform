/**
 * The two tag rules of the platform (not a client setting). Pure, shared by
 * the dashboard (as you type) and the server (what is stored).
 *
 *   internalTag  — Media photo tags, only the team sees them: lower case;
 *                  letters (accents too), numbers, spaces and hyphens; other
 *                  characters are dropped.
 *   websiteLabel — Categories & tags shown on the website: the client's own
 *                  case is kept, but a WORD IN CAPITALS longer than 4 letters
 *                  becomes "Word" (short acronyms stay: DOP, BIO, IGP, SPA).
 *
 * Duplicates are compared ignoring case (sameTagText).
 */

const spaces = (s: string) => s.replace(/\s+/g, ' ').trim()

/** "Café & Bar!" → "café bar". '' when nothing usable is left. */
export function internalTag(raw: string): string {
  const kept = raw.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
  return spaces(kept).replace(/^[-\s]+|[-\s]+$/g, '')
}

/** "PIZZA NAPOLETANA DOP" → "Pizza Napoletana DOP"; "iPhone tips" stays as typed. */
export function websiteLabel(raw: string): string {
  return spaces(raw.normalize('NFC')).replace(/[\p{L}\p{M}]+/gu, (word) =>
    word.length > 4 && word === word.toUpperCase() && word !== word.toLowerCase() ? word.charAt(0) + word.slice(1).toLowerCase() : word
  )
}

/** Same tag, ignoring case and extra spaces. */
export function sameTagText(a: string | undefined, b: string | undefined): boolean {
  return spaces(a ?? '').toLocaleLowerCase() === spaces(b ?? '').toLocaleLowerCase()
}
