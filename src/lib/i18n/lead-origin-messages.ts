/**
 * "Where this lead came from" — labels for the lead-origin block shown in the
 * new-submission notification email and the client dashboard submission
 * detail. Same dictionary pattern as `consent-messages.ts`; unknown locales
 * fall back to English. Row values (URLs, domains, campaign tags) are data and
 * are never translated.
 */

export interface LeadOriginMessages {
  heading: string
  entryPage: string
  referrer: string
  /** Shown as the referrer value when the session started with no external referrer. */
  direct: string
  campaign: string
  adClick: string
  googleAds: string
  metaAds: string
  formPage: string
  cta: string
  location: string
  device: string
  devices: Record<'mobile' | 'tablet' | 'desktop', string>
  language: string
  pagesViewed: string
  timeToSubmit: string
  /** Compact duration, e.g. "3 min 20 s", "1 h 5 min", "40 s". */
  duration: (seconds: number) => string
}

function durationWith(h: string, m: string, s: string) {
  return (total: number): string => {
    const t = Math.max(0, Math.round(total))
    const hours = Math.floor(t / 3600)
    const mins = Math.floor((t % 3600) / 60)
    const secs = t % 60
    if (hours > 0) return mins > 0 ? `${hours} ${h} ${mins} ${m}` : `${hours} ${h}`
    if (mins > 0) return secs > 0 ? `${mins} ${m} ${secs} ${s}` : `${mins} ${m}`
    return `${secs} ${s}`
  }
}

const MESSAGES: Record<string, LeadOriginMessages> = {
  en: {
    heading: 'Where this lead came from',
    entryPage: 'Entry page',
    referrer: 'Came from',
    direct: 'Direct (no referring site)',
    campaign: 'Campaign',
    adClick: 'Ad click',
    googleAds: 'Google Ads',
    metaAds: 'Meta (Facebook/Instagram)',
    formPage: 'Form page',
    cta: 'Button clicked',
    location: 'Location',
    device: 'Device',
    devices: { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop' },
    language: 'Browser language',
    pagesViewed: 'Pages viewed',
    timeToSubmit: 'Time to submit',
    duration: durationWith('h', 'min', 's'),
  },
  it: {
    heading: 'Da dove arriva questo contatto',
    entryPage: 'Pagina di ingresso',
    referrer: 'Proveniente da',
    direct: 'Diretto (nessun sito di provenienza)',
    campaign: 'Campagna',
    adClick: 'Clic su annuncio',
    googleAds: 'Google Ads',
    metaAds: 'Meta (Facebook/Instagram)',
    formPage: 'Pagina del modulo',
    cta: 'Pulsante cliccato',
    location: 'Posizione',
    device: 'Dispositivo',
    devices: { mobile: 'Smartphone', tablet: 'Tablet', desktop: 'Computer' },
    language: 'Lingua del browser',
    pagesViewed: 'Pagine visitate',
    timeToSubmit: 'Tempo prima dell’invio',
    duration: durationWith('h', 'min', 's'),
  },
  de: {
    heading: 'Woher diese Anfrage kommt',
    entryPage: 'Einstiegsseite',
    referrer: 'Gekommen von',
    direct: 'Direkt (keine verweisende Website)',
    campaign: 'Kampagne',
    adClick: 'Anzeigenklick',
    googleAds: 'Google Ads',
    metaAds: 'Meta (Facebook/Instagram)',
    formPage: 'Formularseite',
    cta: 'Geklickter Button',
    location: 'Standort',
    device: 'Gerät',
    devices: { mobile: 'Smartphone', tablet: 'Tablet', desktop: 'Computer' },
    language: 'Browsersprache',
    pagesViewed: 'Besuchte Seiten',
    timeToSubmit: 'Zeit bis zum Absenden',
    duration: durationWith('Std.', 'Min.', 'Sek.'),
  },
}

export function getLeadOriginMessages(locale: string | null | undefined): LeadOriginMessages {
  const base = (locale ?? 'en').toLowerCase().split(/[-_]/)[0]
  return MESSAGES[base] ?? MESSAGES.en
}
