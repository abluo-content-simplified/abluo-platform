import { describe, it, expect } from 'vitest'
import { renderNewSubmissionEmail } from '@/lib/notifications/templates'
import { buildLeadOriginRows } from '@/lib/forms/lead-origin'
import { getLeadOriginMessages } from '@/lib/i18n/lead-origin-messages'

const fullSource = {
  landing_page_url: 'https://ch-psicoterapeuta.com/it?utm_source=google',
  first_referrer: 'https://www.google.com/',
  first_referrer_domain: 'www.google.com',
  first_utm_source: 'google',
  first_utm_medium: 'cpc',
  first_utm_campaign: 'ansia',
  first_gclid: 'abc',
  page_url: 'https://ch-psicoterapeuta.com/it/contatti',
  cta_label_snapshot: 'Prenota',
  cta_internal_name: 'Hero CTA',
  city: 'Varese',
  region: 'VA',
  country: 'IT',
  device_type: 'mobile',
  browser_language: 'it-IT',
  pages_viewed: 3,
  seconds_to_submit: 200,
}

const base = {
  formId: 'contatti',
  topic: 'contatti',
  submissionId: 'sub-1',
  submissionData: { name: 'Ada', email: 'ada@example.test' },
}

describe('lead origin block', () => {
  it('builds every row in order from a full source', () => {
    const rows = buildLeadOriginRows(fullSource, getLeadOriginMessages('en'))
    expect(rows.map((r) => r.key)).toEqual([
      'entryPage', 'referrer', 'campaign', 'adClick', 'formPage', 'cta',
      'location', 'device', 'language', 'pagesViewed', 'timeToSubmit',
    ])
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(v.referrer).toBe('www.google.com')
    expect(v.campaign).toBe('google / cpc · ansia')
    expect(v.adClick).toBe('Google Ads')
    expect(v.cta).toBe('Prenota (Hero CTA)')
    expect(v.location).toBe('Varese, VA, IT')
    expect(v.device).toBe('Mobile')
    expect(v.timeToSubmit).toBe('3 min 20 s')
  })

  it('says "direct" when the session began with no external referrer', () => {
    const rows = buildLeadOriginRows({ landing_page_path: '/it', pages_viewed: 1 }, getLeadOriginMessages('en'))
    expect(rows.find((r) => r.key === 'referrer')!.value).toMatch(/^Direct/)
  })

  it('falls back to per-submit fields for leads stored before first-touch existed', () => {
    const rows = buildLeadOriginRows({ referrer: 'https://x.test/a', referrer_domain: 'x.test', utm_source: 'nl' }, getLeadOriginMessages('en'))
    expect(rows.map((r) => [r.key, r.value])).toEqual([['referrer', 'x.test'], ['campaign', 'nl']])
  })

  it('omits empty rows entirely', () => {
    expect(buildLeadOriginRows({}, getLeadOriginMessages('en'))).toEqual([])
    expect(buildLeadOriginRows({ city: '', country: 'IT', pages_viewed: null }, getLeadOriginMessages('en')).map((r) => r.key)).toEqual(['location'])
  })
})

describe('new-submission email — "Where this lead came from"', () => {
  it('renders the localized block (Italian) with only the populated rows', () => {
    const { html, text } = renderNewSubmissionEmail({ ...base, locale: 'it', source: { country: 'IT', device_type: 'desktop' } })
    expect(html).toContain('Da dove arriva questo contatto')
    expect(html).toContain('Posizione')
    expect(html).toContain('Computer')
    expect(html).not.toContain('Pagina di ingresso')
    expect(html).not.toContain('Campagna')
    expect(text).toContain('Da dove arriva questo contatto:')
  })

  it('renders German labels and falls back to English for an unknown locale', () => {
    expect(renderNewSubmissionEmail({ ...base, locale: 'de', source: fullSource }).html).toContain('Woher diese Anfrage kommt')
    expect(renderNewSubmissionEmail({ ...base, locale: 'pt', source: fullSource }).html).toContain('Where this lead came from')
  })

  it('omits the whole block when there is no attribution at all', () => {
    const { html, text } = renderNewSubmissionEmail({ ...base, locale: 'en', source: {} })
    expect(html).not.toContain('Where this lead came from')
    expect(text).not.toContain('Where this lead came from')
  })

  it('escapes attribution values (they come from the visitor)', () => {
    const { html } = renderNewSubmissionEmail({ ...base, locale: 'en', source: { first_referrer_domain: '<script>x</script>' } })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
