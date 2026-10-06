/**
 * The app's text-size setting scales the root font size, so client UI must size
 * text in rem — a `text-[15px]` would ignore the setting. (AppTextSizeSwitch's
 * preview "A"s are the one deliberate exception.)
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx') && !p.includes('__tests__')) out.push(p)
  }
  return out
}

describe('app text scales with the text-size setting', () => {
  it('client components use rem, not px, for text and line height', () => {
    const files = [...walk('src/components/client'), ...walk('src/app/[locale]/(client)')].filter(
      (f) => !f.endsWith('AppTextSizeSwitch.tsx')
    )
    const offenders = files.filter((f) => /\b(text|leading)-\[[0-9.]+px\]/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
