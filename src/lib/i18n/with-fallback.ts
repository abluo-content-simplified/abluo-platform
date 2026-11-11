/**
 * A message group in one language, with English for whatever that language
 * does not have yet (a new dashboard language such as French fills up over
 * time — machine translation first, a person's review later). Pure: plain
 * objects merge key by key; a non-empty string wins over English.
 */
export function withEnglishFallback<T>(english: T, other: unknown): T {
  if (typeof english === 'string') return (typeof other === 'string' && other.trim() ? other : english) as T
  if (!english || typeof english !== 'object' || Array.isArray(english)) return english
  const src = other && typeof other === 'object' && !Array.isArray(other) ? (other as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(english as Record<string, unknown>)) out[k] = withEnglishFallback(v, src[k])
  return out as T
}
