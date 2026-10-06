import { describe, expect, it } from 'vitest'
import { photoNameFromFile } from '@/lib/media/photo-name'

describe('photoNameFromFile', () => {
  it('drops the extension and turns separators into spaces', () => {
    expect(photoNameFromFile('Foto mare.jpg')).toBe('Foto mare')
    expect(photoNameFromFile('summer_party-02.JPEG')).toBe('summer party 02')
    expect(photoNameFromFile('Praxis Empfang.webp')).toBe('Praxis Empfang')
  })

  it('leaves camera and phone names empty', () => {
    for (const n of ['IMG_1234.jpg', 'IMG-20240101-WA0001.jpg', 'IMG_E0042.HEIC', 'PXL_20240101_101010123.jpg', 'DSC01234.JPG', 'DSCF0001.jpg', '_DSC1234.jpg', 'P1010001.JPG', 'image.png', 'photo 3.jpg', '20240101_123456.jpg', 'GOPR0001.jpg', '3f2a9c1e-1111-2222-3333-444455556666.jpg']) {
      expect(photoNameFromFile(n), n).toBe('')
    }
  })

  it('handles empty input and long names', () => {
    expect(photoNameFromFile('')).toBe('')
    expect(photoNameFromFile(undefined)).toBe('')
    expect(photoNameFromFile(`${'x'.repeat(200)}.jpg`)).toHaveLength(120)
  })
})
