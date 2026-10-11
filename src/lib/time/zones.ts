/**
 * IANA time zones — ADR-031 D6/D7.
 *
 * A website has one time zone (Website Settings → Languages → Time zone); an
 * event venue may override it. Event dates are stored as exact instants (UTC)
 * and are shown — and shared — in the zone of the place they happen in.
 */

/** True when the runtime recognises `value` as an IANA time zone. */
export function isValidTimeZone(value: string): boolean {
  if (!value) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Studio option list of every IANA zone the runtime knows, or undefined. */
export function timeZoneOptions(): { title: string; value: string }[] | undefined {
  try {
    const zones = (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf('timeZone')
    return zones.map((z) => ({ title: z.replace(/_/g, ' '), value: z }))
  } catch {
    return undefined
  }
}

/**
 * The zone an event is shown in: the venue's own zone, else the website's,
 * else undefined (the formatter then uses the server zone — the pre-ADR-031
 * behaviour, kept for sites that have not set one yet).
 */
export function resolveTimeZone(...candidates: (string | null | undefined)[]): string | undefined {
  for (const c of candidates) if (c && isValidTimeZone(c)) return c
  return undefined
}
