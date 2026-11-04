import { describe, expect, it } from 'vitest'
import { LOTTIE_LIMITS, lottieSeconds, readLottie } from '../lottie'
import checkmark from '@/lib/animations/checkmark.json'

const enc = (s: string) => new TextEncoder().encode(s)
const lottie = (o: Record<string, unknown> = {}) => enc(JSON.stringify({ v: '5.7.4', fr: 25, ip: 0, op: 41, w: 900, h: 849, layers: [], ...o }))
/** A ZIP local-file header followed by the names a .lottie archive carries. */
const zip = (...names: string[]) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, ...enc(names.join('\0'))])

describe('readLottie (ADR-046)', () => {
  it('reads a plain Lottie JSON: size, frame rate and length', () => {
    expect(readLottie(lottie())).toEqual({ format: 'lottie-json', width: 900, height: 849, frameRate: 25, frames: 41 })
    expect(lottieSeconds(readLottie(lottie()))).toBeCloseTo(1.64)
  })

  it('accepts leading whitespace and a UTF-8 BOM', () => {
    expect(readLottie(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('\n  '), ...lottie()]))?.format).toBe('lottie-json')
  })

  it('recognises a .lottie archive by its ZIP header, manifest and animations folder', () => {
    expect(readLottie(zip('manifest.json', 'animations/rider.json'))).toEqual({ format: 'dotlottie' })
    expect(readLottie(zip('word/document.xml'))).toBeNull() // any other ZIP (a .docx)
    expect(readLottie(zip('manifest.json'))).toBeNull()
  })

  it('refuses everything that is not an animation', () => {
    expect(readLottie(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull() // PNG
    expect(readLottie(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(readLottie(enc('{"name":"package","version":"1.0.0"}'))).toBeNull() // some other JSON
    expect(readLottie(enc('[1,2,3]'))).toBeNull()
    expect(readLottie(enc('{"v":"5"'))).toBeNull() // broken JSON
    expect(readLottie(lottie({ layers: 'x' }))).toBeNull()
    expect(readLottie(lottie({ op: 0 }))).toBeNull() // no length
    expect(readLottie(lottie({ w: 0 }))).toBeNull()
    expect(readLottie(new Uint8Array([0xff, 0xfe, 0x7b]))).toBeNull() // not UTF-8
    expect(readLottie(new Uint8Array())).toBeNull()
  })

  it('refuses a file over the size limit without parsing it', () => {
    const big = new Uint8Array(LOTTIE_LIMITS.maxBytes + 1)
    big[0] = 0x7b
    expect(readLottie(big)).toBeNull()
  })

  it('accepts the platform checkmark', () => {
    expect(readLottie(enc(JSON.stringify(checkmark)))).toMatchObject({ format: 'lottie-json', width: 120, height: 120 })
  })

  it('lottieSeconds is null when the length is unknown', () => {
    expect(lottieSeconds({ format: 'dotlottie' } as never)).toBeNull()
    expect(lottieSeconds(null)).toBeNull()
  })
})
