import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOTLOTTIE_VERSION, DOTLOTTIE_WASM_URL, stillFrame } from '../AnimationPreview'

const root = path.resolve(__dirname, '../../../../..')

describe('AnimationPreview (ADR-046)', () => {
  it('the self-hosted player file matches the installed player version', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@lottiefiles/dotlottie-web']).toBe(DOTLOTTIE_VERSION)
    const installed = JSON.parse(readFileSync(path.join(root, 'node_modules/@lottiefiles/dotlottie-web/package.json'), 'utf8')) as { version: string }
    expect(installed.version).toBe(DOTLOTTIE_VERSION)
    const served = path.join(root, 'public', DOTLOTTIE_WASM_URL)
    expect(existsSync(served)).toBe(true)
    expect(readFileSync(served).equals(readFileSync(path.join(root, 'node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm')))).toBe(true)
  })

  it('stillFrame picks the first, middle or last frame', () => {
    expect(stillFrame(41, 'first')).toBe(0)
    expect(stillFrame(41, 'middle')).toBe(20)
    expect(stillFrame(41, 'last')).toBe(40)
    expect(stillFrame(0, 'last')).toBe(0)
    expect(stillFrame(Number.NaN, 'middle')).toBe(0)
  })
})
