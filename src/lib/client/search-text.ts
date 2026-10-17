/** Accent- and case-insensitive text for list search ("perche" finds "Perché"). One rule for every dashboard list. */
export function searchText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}
