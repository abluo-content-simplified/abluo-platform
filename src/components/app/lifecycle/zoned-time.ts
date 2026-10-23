/**
 * Showing and entering lifecycle dates in the SITE's time zone (ADR-032 D8),
 * whoever is looking and wherever they are. Pure helpers around
 * `@/lib/lifecycle/time` (DST rules live there).
 */
import { localToUtc, utcToLocal, type LocalDateTime, type Resolution } from '@/lib/lifecycle/time'

/** A usable IANA zone, else null (the caller falls back to the viewer's zone). */
export function validZone(zone: string | null | undefined): string | null {
  if (!zone) return null
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return zone
  } catch {
    return null
  }
}

/** The zone the editor works in: the site's, else the viewer's own. */
export function editingZone(siteZone: string | null | undefined): string {
  return validZone(siteZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}

/** "15 Oct 2026, 09:30" in `zone`. */
export function formatInZone(iso: string | null | undefined, zone: string, locale: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: zone }).format(d)
}

/** "GMT+2" — the zone's offset at that moment (DST-aware). */
export function offsetLabel(iso: string | number, zone: string, locale: string): string {
  const d = new Date(iso)
  const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')
  return part?.value ?? ''
}

/** A `datetime-local` value shown in `zone` for a UTC instant. */
export function toLocalInput(iso: string | null | undefined, zone: string): LocalDateTime {
  if (!iso) return ''
  try {
    return utcToLocal(iso, zone)
  } catch {
    return ''
  }
}

/** A `datetime-local` value typed in `zone` → UTC + how DST resolved it; null when incomplete or invalid. */
export function fromLocalInput(local: string, zone: string): { utc: string; resolution: Resolution } | null {
  if (!local) return null
  try {
    return localToUtc(local.slice(0, 16), zone)
  } catch {
    return null
  }
}
