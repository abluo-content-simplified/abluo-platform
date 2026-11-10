'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Paste a picture straight in (Tom, 2026-11-10): ⌘V / Ctrl+V of a screenshot
 * or a copied image file adds it wherever a picture can be added — the same
 * path as choosing a file, so every server check still applies (type read from
 * the bytes, size limits, metadata stripped, Media Library photos optimised).
 *
 * Safe by construction:
 *   • the browser hands over clipboard files only when the person pastes into
 *     the page — nothing is ever read from the clipboard on its own;
 *   • a clipboard that carries text is left alone, so pasting into a text
 *     field keeps working as always;
 *   • only files whose type `accept` allows are taken (images by default).
 *
 * Only a picker that is visible can receive a paste (a closed panel or a hidden
 * wizard step never does). Several pickers on one page: the paste goes to the picker the person is in
 * (focus or last click inside its `scope` element); with only one picker on
 * the page it goes there. With several and none chosen, nothing happens — a
 * picture never lands somewhere unexpected.
 */
type Target = {
  scope: RefObject<HTMLElement | null>
  accept: (type: string) => boolean
  onFiles: (files: File[]) => void
  lastUsed: number
}

const targets = new Set<Target>()
let listening = false

function pick(e: ClipboardEvent): void {
  const data = e.clipboardData
  if (!data || data.types.includes('text/plain')) return
  const files = Array.from(data.files)
  if (!files.length) return
  const active = document.activeElement
  // Only pickers the person can see right now (a closed panel or a hidden wizard step never receives a paste).
  const list = [...targets].filter((t) => t.scope.current !== null && t.scope.current.getClientRects().length > 0)
  const inside = list.filter((t) => t.scope.current && active && t.scope.current.contains(active))
  const recent = list.filter((t) => t.lastUsed > 0).sort((a, b) => b.lastUsed - a.lastUsed)
  const target = inside[0] ?? recent[0] ?? (list.length === 1 ? list[0] : undefined)
  if (!target) return
  const taken = files.filter((f) => target.accept(f.type))
  if (!taken.length) return
  e.preventDefault()
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  target.onFiles(
    taken.map((f, i) =>
      f.name && f.name !== 'image.png' ? f : new File([f], `screenshot-${stamp}${i ? `-${i + 1}` : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type }),
    ),
  )
}

function listen() {
  if (listening) return
  listening = true
  document.addEventListener('paste', pick)
}
function unlisten() {
  if (targets.size || !listening) return
  listening = false
  document.removeEventListener('paste', pick)
}

export function usePasteFiles(
  onFiles: (files: File[]) => void,
  { enabled = true, accept, scope }: { enabled?: boolean; accept?: readonly string[]; scope: RefObject<HTMLElement | null> },
): void {
  const latest = useRef(onFiles)
  useEffect(() => {
    latest.current = onFiles
  })
  const scopeRef = scope
  const acceptKey = (accept ?? []).join(',')
  useEffect(() => {
    if (!enabled) return
    const types = acceptKey ? acceptKey.split(',') : []
    const target: Target = {
      scope: scopeRef,
      accept: (type) => (types.length ? types.includes(type) : type.startsWith('image/')),
      onFiles: (files) => latest.current(files),
      lastUsed: 0,
    }
    const mark = (e: Event) => {
      if (scopeRef.current && e.target instanceof Node && scopeRef.current.contains(e.target)) target.lastUsed = Date.now()
    }
    targets.add(target)
    listen()
    document.addEventListener('pointerdown', mark, true)
    document.addEventListener('focusin', mark, true)
    return () => {
      targets.delete(target)
      document.removeEventListener('pointerdown', mark, true)
      document.removeEventListener('focusin', mark, true)
      unlisten()
    }
  }, [enabled, acceptKey, scopeRef])
}
