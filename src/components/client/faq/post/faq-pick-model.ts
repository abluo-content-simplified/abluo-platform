import type { SiteFaqSet } from '@/components/client/create/types'

/**
 * The sets the "Choose existing" list offers (ADR-037 D9): never archived
 * ones; when searching, those whose name or first questions contain every
 * word of the query (case and accents ignored). Order is kept (most recently
 * edited first, as the server lists them).
 */
export function filterFaqSetsForPick<S extends Pick<SiteFaqSet, 'name' | 'state' | 'firstQuestions'>>(sets: readonly S[], query: string): S[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  return sets.filter((s) => {
    if (s.state === 'archived') return false
    if (!words.length) return true
    const text = fold([s.name, ...s.firstQuestions].join(' '))
    return words.every((w) => text.includes(w))
  })
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
