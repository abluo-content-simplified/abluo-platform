/**
 * Tom's rule (2026-11-08): every delete asks first. The dialog names what will
 * be deleted and says the classes go too; and nothing in the Courses list sends
 * a delete without going through that dialog.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import all from '../../../../../messages/en.json'
import { CoursesDeleteDialog } from '../CoursesDeleteDialog'
import type { CourseRow } from '../course-bits'

// Only the namespaces the dialog reads (the full file has unrelated keys next-intl warns about).
const messages = { clientDashboard: { courses: { list: all.clientDashboard.courses.list } } }

const row = (title: string, classes: number): CourseRow =>
  ({ id: title, title, state: 'draft', isPublished: false, schedule: { classes, teachers: [], nextClassAt: null } }) as unknown as CourseRow

const html = (courses: CourseRow[], skipped = 0) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CoursesDeleteDialog courses={courses} skipped={skipped} onConfirm={() => {}} onCancel={() => {}} />
    </NextIntlClientProvider>
  ).replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')

describe('delete confirmation dialog', () => {
  it('names the course and says its classes go too', () => {
    const out = html([row('Yoga Test', 3)])
    expect(out).toContain('Delete “Yoga Test”?')
    expect(out).toContain('Its 3 classes go too.')
    expect(out).toContain('>Delete<')
  })
  it('lists several courses and says their classes go too', () => {
    const out = html([row('Yoga', 2), row('Pilates', 0), row('Tai Chi', 1)], 1)
    expect(out).toContain('Delete 3 courses?')
    expect(out).toContain('Their 3 classes go too.')
    for (const name of ['Yoga', 'Pilates', 'Tai Chi']) expect(out).toContain(`<li>${name}`)
    expect(out).toContain('1 selected course isn')
  })
  it('does not claim classes when there are none', () => {
    expect(html([row('Empty', 0)])).not.toContain('classes go too')
  })
})

describe('the Courses list never deletes behind a toast alone', () => {
  const src = readFileSync(join(__dirname, '../CoursesBrowser.tsx'), 'utf8')
  it('no direct delete op is sent from the list', () => {
    expect(src).not.toMatch(/op:\s*'delete(Draft|Permanently)'/)
    expect(src).not.toContain('DeletePermanentlyDialog')
  })
  it('both delete entries in the row menu open the dialog', () => {
    expect(src.match(/onSelect: \(\) => askDelete\(c\)/g)).toHaveLength(2)
  })
  it('the only call that deletes is made from the dialog\'s confirm', () => {
    const calls = [...src.matchAll(/op: 'delete'/g)]
    expect(calls).toHaveLength(1)
    const at = calls[0].index!
    expect(src.slice(src.lastIndexOf('async function', at), at)).toContain('async function confirmDelete')
  })
})
