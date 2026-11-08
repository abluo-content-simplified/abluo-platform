// @vitest-environment jsdom
/** Settings → Translations (Tom, 2026-11-08): used / limit, reset date, near and reached notices, unavailable. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '@/components/app/ui/__tests__/intl-dom'
import { translationUsageView } from '@/lib/translate/usage-view'

vi.mock('next-intl', async () => {
  const u = await import('use-intl')
  return { ...u, NextIntlClientProvider: u.IntlProvider }
})
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children, className }: { href: string; children?: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }))

import { TranslationUsage } from '../TranslationUsage'

const NOV = new Date('2026-11-08T10:00:00Z')
let m: Mounted | null = null
afterEach(() => m?.unmount())
const text = () => (m!.host.textContent ?? '').replace(/[  ]/g, ' ')

describe('TranslationUsage', () => {
  it('with a limit: numbers, bar and reset day', () => {
    m = mount(<TranslationUsage projectSlug="abluo" view={translationUsageView(12400, 50000, NOV)} />)
    expect(text()).toContain('12,400 of 50,000 characters used this month')
    expect(text()).toContain('The count starts again on December 1.')
    expect(m.host.querySelector('[aria-hidden="true"] .bg-action')).not.toBeNull()
    expect(text()).not.toContain('You’ve used')
  })
  it('without a limit', () => {
    m = mount(<TranslationUsage projectSlug="abluo" view={translationUsageView(1200, null, NOV)} />)
    expect(text()).toContain('1,200 characters translated this month')
    expect(text()).toContain('No monthly limit.')
  })
  it('near the limit', () => {
    m = mount(<TranslationUsage projectSlug="abluo" view={translationUsageView(42500, 50000, NOV)} />)
    expect(text()).toContain('You’ve used 85% of this month’s translations.')
  })
  it('limit reached: says when it works again and links to Support', () => {
    m = mount(<TranslationUsage projectSlug="abluo" view={translationUsageView(50000, 50000, NOV)} />)
    expect(text()).toContain('works again on December 1')
    expect(m.host.querySelector('a[href="/abluo/support"]')?.textContent).toBe('Write to Support')
  })
  it('unavailable never shows 0', () => {
    m = mount(<TranslationUsage projectSlug="abluo" view="unavailable" />)
    expect(text()).toContain('Usage can’t be shown right now.')
    expect(text()).not.toContain('0 characters')
  })
  it('Italian and German', () => {
    m = mount(<TranslationUsage projectSlug="abluo" view={translationUsageView(12400, 50000, NOV)} />, 'it')
    expect(text()).toContain('12.400 di 50.000 caratteri usati questo mese')
    m.unmount()
    m = mount(<TranslationUsage projectSlug="abluo" view={translationUsageView(12400, 50000, NOV)} />, 'de')
    expect(text()).toContain('12.400 von 50.000 Zeichen diesen Monat genutzt')
    expect(text()).toContain('1. Dezember')
  })
})
