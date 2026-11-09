/**
 * Selection controls: the off / unselected state must be visible on its own —
 * WCAG 2.2 SC 1.4.11 non-text contrast ≥ 3:1 against the surface — in the
 * dashboard's light AND dark themes, on the page and on a card (round 4 audit,
 * 2026-11-09). Reads the real tokens from globals.css (`.abluo-app` and
 * `.abluo-app[data-theme="dark"]`) and the classes the shared components use.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { segmentClass } from '../segmented-keys'
import { tabClass } from '../tab-styles'

const ROOT = path.resolve(__dirname, '../../../../..')
const css = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

function block(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no ${selector}`)
  const body = css.slice(at, css.indexOf('}', at))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z-]+):\s*(oklch\([^)]*\))/g)) out[m[1]] = m[2]
  return out
}

/** OKLCH → linear sRGB (clamped) → relative luminance. */
function luminance(value: string): number {
  const [L, C = 0, h = 0] = value.replace(/oklch\(|\)/g, '').split('/')[0].trim().split(/\s+/).map(Number)
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const c = (x: number) => Math.min(1, Math.max(0, x))
  const r = c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}
const contrast = (x: string, y: string) => {
  const [a, b] = [luminance(x) + 0.05, luminance(y) + 0.05]
  return Math.max(a, b) / Math.min(a, b)
}

const themes = { light: block('.abluo-app'), dark: block('.abluo-app[data-theme="dark"]') }

describe('dashboard tokens: the boundary of an unselected control (input) is ≥ 3:1', () => {
  for (const [name, t] of Object.entries(themes)) {
    for (const surface of ['background', 'card'] as const) {
      it(`${name}: input vs ${surface}`, () => {
        expect(contrast(t.input, t[surface])).toBeGreaterThanOrEqual(3)
      })
    }
    it(`${name}: the switch knob (background) vs the off track (input)`, () => {
      expect(contrast(t.background, t.input)).toBeGreaterThanOrEqual(3)
    })
    it(`${name}: the old off states were NOT enough (why they changed)`, () => {
      // muted fill as the only "selected" mark of a soft segment; border as an unselected boundary.
      expect(contrast(t.muted, t.background)).toBeLessThan(3)
      expect(contrast(t.border, t.card)).toBeLessThan(3)
    })
  }
})

describe('the shared controls use those tokens for their off / unselected state', () => {
  it('Switch: off track = input, on = action', () => {
    const src = read('src/components/app/ui/Switch.tsx')
    expect(src).toContain("checked ? 'bg-action' : 'bg-input'")
    expect(src).not.toMatch(/muted-foreground\/\d+/)
  })
  it('Checkbox: unchecked box border = input', () => {
    expect(read('src/components/app/ui/Checkbox.tsx')).toContain("'border-input bg-background")
  })
  it('SegmentedControl soft / pill: the selected segment carries an input ring (the fill alone is ~1.1:1)', () => {
    expect(segmentClass('soft', true)).toContain('ring-input')
    expect(segmentClass('pill', true)).toContain('ring-input')
    expect(segmentClass('solid', true)).toContain('bg-action')
  })
  it('ChoiceCard: an unselected choice has an input border', () => {
    expect(read('src/components/app/ui/ChoiceCard.tsx')).toContain("radio ? 'border-input' : 'border-border'")
  })
  it('Tabs: inactive = muted-foreground text (≥ 4.5:1), selected = action underline', () => {
    expect(tabClass(false)).toContain('text-muted-foreground')
    expect(tabClass(true)).toContain('border-action')
    for (const t of Object.values(themes)) {
      expect(contrast(t['muted-foreground'], t.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.action, t.background)).toBeGreaterThanOrEqual(3)
    }
  })
})
