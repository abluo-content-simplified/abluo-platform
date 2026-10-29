import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DownloadDocumentList } from '@/components/sections/DownloadDocumentList'
import type { DownloadSectionDocument } from '@/lib/sanity/types'

const labels = { view: 'Open', download: 'Download', lock: 'Members only', all: 'All', filter: 'Filter' }
const doc = {
  id: 'd1',
  title: 'Timetable November',
  note: 'Weekly classes',
  members: true,
  tags: [],
  category: { key: 'schedule', label: 'Schedule' },
  href: '/api/doc/d1',
  file: { mimeType: 'application/pdf', sizeBytes: 179000, locale: 'en' },
} as unknown as DownloadSectionDocument

const html = renderToStaticMarkup(
  <DownloadDocumentList documents={[doc]} meta={{ d1: 'Schedule · PDF · 179 kB' }} labels={labels} />,
)

describe('DownloadDocumentList layout', () => {
  it('orders title, description, meta, then actions', () => {
    const order = ['Timetable November', 'Weekly classes', 'Schedule · PDF · 179 kB', 'data-document-actions']
    const idx = order.map((t) => html.indexOf(t))
    expect(idx.every((i) => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })

  it('puts the lock inline in the title row with its label', () => {
    const titleP = html.slice(html.indexOf('<p'), html.indexOf('</p>'))
    expect(titleP).toContain('Timetable November')
    expect(titleP).toContain('aria-label="Members only"')
  })

  it('labels the first action Open and keeps link attributes', () => {
    expect(html).toContain('>Open</a>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('href="/api/doc/d1?download=1"')
    expect(html).toContain('rel="nofollow"')
  })
})
