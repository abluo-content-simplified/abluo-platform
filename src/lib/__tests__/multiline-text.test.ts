import { describe, it, expect } from 'vitest'
import { MULTILINE_TEXT, multiline, previewLines } from '@/lib/multiline-text'

describe('multiline()', () => {
  it('is the pre-line class on its own', () => {
    expect(MULTILINE_TEXT).toBe('whitespace-pre-line')
    expect(multiline()).toBe('whitespace-pre-line')
    expect(multiline(null)).toBe('whitespace-pre-line')
    expect(multiline('  ')).toBe('whitespace-pre-line')
  })

  it('keeps the element\'s own classes', () => {
    expect(multiline('text-sm leading-relaxed line-clamp-3')).toBe('whitespace-pre-line text-sm leading-relaxed line-clamp-3')
  })
})

describe('previewLines()', () => {
  it('keeps a single typed break (the CYCE event case)', () => {
    const t = 'Save the date!\n€30 for CYCE members | €35 for non-members'
    expect(previewLines(t)).toBe(t)
  })

  it('turns a paragraph gap into one break so the clamp is not spent on an empty line', () => {
    expect(previewLines('A Healthy Smile\n\nMany people visit…\n\n\nPrevention')).toBe('A Healthy Smile\nMany people visit…\nPrevention')
  })

  it('drops spaces around breaks, Windows line endings and edge whitespace', () => {
    expect(previewLines('  one \r\n  two\r\n\r\n')).toBe('one\ntwo')
  })

  it('leaves text without breaks alone and passes through empty values', () => {
    expect(previewLines('Just one line.')).toBe('Just one line.')
    expect(previewLines(undefined)).toBeUndefined()
    expect(previewLines(null)).toBeNull()
  })
})
