import { describe, expect, it } from 'vitest'
import { cleanFileName, isPdf, prepareMessageFiles } from '../files'
import { MESSAGE_LIMITS } from '../model'

const enc = (s: string) => new TextEncoder().encode(s)
const pdf = (size = 200) => {
  const head = enc('%PDF-1.7\n')
  const tail = enc('\n%%EOF\n')
  const out = new Uint8Array(Math.max(size, head.length + tail.length))
  out.set(head, 0)
  out.set(tail, out.length - tail.length)
  return out
}
// 1×1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))

describe('message files (ADR-050 D5)', () => {
  it('recognises a PDF from its bytes, not its name', () => {
    expect(isPdf(pdf())).toBe(true)
    expect(isPdf(enc('hello, not a pdf at all'))).toBe(false)
  })
  it('keeps a PDF as it is and gives it a safe name', () => {
    const r = prepareMessageFiles([{ name: '../../etc/Offer "2026".pdf', type: 'application/pdf', bytes: pdf() }])
    expect(r.ok && r.value[0].mime).toBe('application/pdf')
    expect(r.ok && r.value[0].name).toBe('Offer 2026.pdf')
  })
  it('cleans images like ticket screenshots', () => {
    const r = prepareMessageFiles([{ name: 'shot.png', type: 'image/png', bytes: PNG }])
    expect(r.ok && r.value[0].mime).toBe('image/png')
  })
  it('refuses unknown types, too many files and too large PDFs', () => {
    expect(prepareMessageFiles([{ name: 'x.exe', type: '', bytes: enc('MZ………………………') }])).toEqual({ ok: false, reason: 'attachmentType' })
    expect(prepareMessageFiles(Array.from({ length: MESSAGE_LIMITS.attachmentsMax + 1 }, () => ({ name: 'a.png', type: 'image/png', bytes: PNG })))).toEqual({ ok: false, reason: 'tooManyAttachments' })
    expect(prepareMessageFiles([{ name: 'big.pdf', type: 'application/pdf', bytes: pdf(MESSAGE_LIMITS.pdfBytesMax + 1) }])).toEqual({ ok: false, reason: 'attachmentTooLarge' })
  })
  it('names without a stem get a default', () => {
    expect(cleanFileName('', 'application/pdf')).toBe('document.pdf')
    expect(cleanFileName('photo.HEIC', 'image/jpeg')).toBe('photo.jpg')
  })
})
