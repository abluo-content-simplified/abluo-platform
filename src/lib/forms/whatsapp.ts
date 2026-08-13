/**
 * WhatsApp click-to-chat helpers — ADR-018 (WhatsApp channel).
 *
 * WhatsApp has no send-on-behalf API for a public site; the standard, free path
 * is a `wa.me` deep link that opens a chat with the practice and PRE-FILLS the
 * message box (the visitor taps send). We compose the pre-filled text from the
 * subject + message the visitor picks in our overlay, and — because that overlay
 * is our own form — we save the lead first so it lands in the dashboard too.
 *
 * Pure + framework-free so the link building is unit-testable.
 */

/** Strips a phone number to digits (wa.me wants a bare international number). */
export function whatsappDigits(number: string | null | undefined): string {
  return (number ?? '').replace(/[^\d]/g, '')
}

/** True when a number has enough digits to be a plausible WhatsApp number. */
export function hasWhatsAppNumber(number: string | null | undefined): boolean {
  return whatsappDigits(number).length >= 8
}

/**
 * Builds a `wa.me` click-to-chat URL. `text` is pre-filled into the message box
 * (URL-encoded); omit it for a bare chat open.
 */
export function buildWhatsAppLink(number: string | null | undefined, text?: string | null): string {
  const base = `https://wa.me/${whatsappDigits(number)}`
  return text && text.trim() ? `${base}?text=${encodeURIComponent(text)}` : base
}
