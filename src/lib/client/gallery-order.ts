/**
 * Pure list helpers for the gallery photo grid (reorder, remove, keys).
 * The server keeps the order and the keys it is sent (`patchGalleryDraft`
 * rebuilds items from this ordered list).
 */

/** Moves the item at `from` to `to` (both clamped). Returns a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice()
  if (from < 0 || from >= next.length) return next
  const target = Math.max(0, Math.min(next.length - 1, to))
  if (target === from) return next
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

/** Moves the item with `key` one place earlier (-1) or later (+1). */
export function moveByKey<T extends { key: string }>(items: readonly T[], key: string, delta: -1 | 1): T[] {
  const i = items.findIndex((it) => it.key === key)
  return i < 0 ? items.slice() : moveItem(items, i, i + delta)
}

/** Drops every item whose key is in `keys`. */
export function removeKeys<T extends { key: string }>(items: readonly T[], keys: Iterable<string>): T[] {
  const drop = new Set(keys)
  return items.filter((it) => !drop.has(it.key))
}

/**
 * Where a dragged tile lands: the index of the tile rect whose centre is
 * nearest to the pointer (row-major grid). `rects` are in list order.
 */
export function dropIndex(rects: readonly { left: number; top: number; width: number; height: number }[], x: number, y: number): number {
  let best = -1
  let bestDist = Infinity
  rects.forEach((r, i) => {
    const dx = r.left + r.width / 2 - x
    const dy = r.top + r.height / 2 - y
    const d = dx * dx + dy * dy
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
}

const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A new item key the server accepts (`[A-Za-z0-9_-]{1,64}`), unique among `taken`. */
export function newItemKey(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken)
  for (;;) {
    let k = 'p'
    for (let i = 0; i < 11; i++) k += KEY_CHARS[Math.floor(random() * KEY_CHARS.length) % KEY_CHARS.length]
    if (!used.has(k)) return k
  }
}
