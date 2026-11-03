// ── People — public contact links (ADR-043 D2, D7) ────────────────────────────
//
// Pure. Turns one PUBLIC contact into what the website renders.
//
//   • email     → NEVER a plain address in the server HTML. The address is
//                 reversed and base64-encoded here and assembled in the browser
//                 by <ObfuscatedEmail> (mailto: is built client-side only).
//   • whatsapp  → https://wa.me/<digits> click-to-chat.
//   • phone     → tel:
//   • instagram / linkedin / website / url → https links (rel noopener).
//
// A value that does not look right for its kind yields null (dropped), never a
// broken or unsafe link. Private contacts never reach the website.

import { safeLinkHref } from '@/lib/links/safe-href'
import type { PersonPublicContact } from '@/lib/modules/people/projection'
import type { PeopleMessages } from '@/lib/i18n/people-messages'

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/

function utf8ToBinary(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join('')
}
function binaryToUtf8(bin: string): string {
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** reversed + base64: not the address, and not a pattern a plain-text scraper matches. */
export function encodeEmail(address: string): string {
  return btoa(utf8ToBinary(Array.from(address).reverse().join('')))
}

export function decodeEmail(encoded: string): string | null {
  try {
    const value = Array.from(binaryToUtf8(atob(encoded))).reverse().join('')
    return EMAIL_RE.test(value) ? value : null
  } catch {
    return null
  }
}

export type ContactLink =
  | { type: 'email'; key: string; encoded: string; label: string }
  | { type: 'link'; key: string; href: string; text: string; external: boolean }

const handle = (v: string) => v.trim().replace(/^@/, '')

function hostLabel(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./, '')
  } catch {
    return href
  }
}

export function contactLink(contact: PersonPublicContact, msg: PeopleMessages): ContactLink | null {
  const value = (contact.value ?? '').trim()
  if (!value) return null
  const label = contact.label?.trim() || ''
  const key = contact._key

  switch (contact.kind) {
    case 'email':
      return EMAIL_RE.test(value) ? { type: 'email', key, encoded: encodeEmail(value), label: label || msg.email } : null
    case 'phone': {
      const digits = value.replace(/[^\d]/g, '')
      if (digits.length < 5 || digits.length > 15) return null
      return { type: 'link', key, href: `tel:${value.startsWith('+') ? '+' : ''}${digits}`, text: label ? `${label}: ${value}` : value, external: false }
    }
    case 'whatsapp': {
      const digits = value.replace(/[^\d]/g, '')
      if (digits.length < 6 || digits.length > 15) return null
      return { type: 'link', key, href: `https://wa.me/${digits}`, text: label || msg.whatsapp, external: true }
    }
    case 'instagram': {
      const href = /^https?:\/\//i.test(value) ? safeLinkHref(value) : /^[A-Za-z0-9._]{1,30}$/.test(handle(value)) ? `https://www.instagram.com/${handle(value)}/` : null
      return href ? { type: 'link', key, href, text: label || msg.instagram, external: true } : null
    }
    case 'linkedin': {
      const href = /^https?:\/\//i.test(value) ? safeLinkHref(value) : /^[A-Za-z0-9_%-]{2,100}$/.test(handle(value)) ? `https://www.linkedin.com/in/${handle(value)}/` : null
      return href ? { type: 'link', key, href, text: label || msg.linkedin, external: true } : null
    }
    case 'website':
    case 'url': {
      const href = /^https?:\/\//i.test(value) ? safeLinkHref(value) : null
      return href ? { type: 'link', key, href, text: label || hostLabel(href), external: true } : null
    }
    default:
      return null
  }
}

/** Preferred contacts first, otherwise the editor's order. */
export function orderedContacts(contacts: readonly PersonPublicContact[] | null | undefined): PersonPublicContact[] {
  const list = (contacts ?? []).filter(Boolean)
  return [...list.filter((c) => c.preferred), ...list.filter((c) => !c.preferred)]
}
