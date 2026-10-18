/**
 * Navigation labels in English are Title Case (Tom, 2026-10-18): every word
 * starts with a capital — "Contact Requests", "Partner Apps", "What’s New",
 * "Component Lab". Small joining words (&, and, of) stay as they are.
 * Italian and German follow their own rules and are not checked.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const en = JSON.parse(readFileSync(path.join(process.cwd(), 'messages/en.json'), 'utf8'))
const SMALL = new Set(['&', 'and', 'of', 'to', 'in', 'on', 'for', 'a', 'the'])

function notTitleCase(label: string): boolean {
  return label.split(/\s+/).some((w, i) => /^[a-z]/.test(w) && (i === 0 || !SMALL.has(w)))
}

describe('English navigation labels are Title Case', () => {
  const groups: Record<string, Record<string, string>> = {
    'clientDashboard.nav': en.clientDashboard.nav,
    'admin.nav': en.admin.nav,
    'sidebar rows': { whatsNew: en.clientDashboard.whatsNew.title, signOut: en.app.shell.signOut },
  }
  for (const [name, labels] of Object.entries(groups)) {
    it(name, () => {
      const wrong = Object.entries(labels).filter(([, v]) => typeof v === 'string' && notTitleCase(v))
      expect(wrong).toEqual([])
    })
  }
})
