import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Abluo App design system guards (ADR-025 D7, verification T1 + T2).
 *
 * T1 — every text/background pair the app uses meets WCAG AA in light AND dark,
 *      computed from the scoped `.abluo-app` tokens in globals.css.
 * T2 — client UI code never uses raw palette colours, so dark mode can't regress.
 */

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`selector not found: ${selector}`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const vars: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim()
  return vars
}

function oklchToLinearRgb(value: string): [number, number, number] {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (!m) throw new Error(`not an opaque oklch() colour: ${value}`)
  const [L, C, H] = m.slice(1).map(Number)
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ]
}

function contrast(fg: string, bg: string): number {
  const lum = (c: string) => {
    const [r, g, b] = oklchToLinearRgb(c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const THEMES = {
  light: block('.abluo-app'),
  dark: { ...block('.abluo-app'), ...block('.abluo-app[data-theme="dark"]') },
}

/** [foreground, background, minimum ratio] — text 4.5, controls/focus 3. */
const PAIRS: [string, string, number][] = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['action-foreground', 'action', 4.5],
  ['primary', 'background', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive', 'background', 4.5],
  ['success', 'background', 4.5],
  ['admin-foreground', 'admin', 4.5],
  ['ring', 'background', 3],
  ['input', 'background', 3],
]

describe('T1 — Abluo App contrast (light and dark)', () => {
  for (const [theme, vars] of Object.entries(THEMES)) {
    for (const [fg, bg, min] of PAIRS) {
      it(`${theme}: ${fg} on ${bg} ≥ ${min}:1`, () => {
        expect(vars[fg], `--${fg} missing in ${theme}`).toBeDefined()
        expect(vars[bg], `--${bg} missing in ${theme}`).toBeDefined()
        expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(min)
      })
    }
  }

  it('dark mode follows the device when no explicit choice is set', () => {
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)', css.indexOf('.abluo-app {')))
    expect(media).toContain('.abluo-app:not([data-theme])')
    expect(block('.abluo-app:not([data-theme])')).toEqual(block('.abluo-app[data-theme="dark"]'))
  })

  it('never redefines app tokens on :root (tenant websites read :root)', () => {
    const root = block(':root')
    for (const appOnly of ['action', 'success', 'admin', 'hover', 'border-subtle', 'selected-tint']) {
      expect(root[appOnly]).toBeUndefined()
    }
  })
})

// Every Abluo App surface (ADR-030): the shared layer, the client dashboard, the admin and the auth pages.
const CLIENT_DIRS = [
  'src/components/app',
  'src/components/client',
  'src/app/[locale]/(client)',
  'src/components/admin',
  'src/app/[locale]/(admin)',
  // The signed-out pages render inside the same `.abluo-app` root.
  'src/components/auth',
  'src/app/(platform)/(auth)',
]
const RAW_COLOUR =
  /\b(?:bg|text|border|ring|divide|outline|fill|stroke|from|to|via|placeholder|shadow)-(?:zinc|gray|slate|neutral|stone|white|black|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b|#[0-9a-fA-F]{3,8}\b|\brgba?\(/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : files(p)
    return /\.(tsx?|css)$/.test(name) ? [p] : []
  })
}

describe('T2 — no raw colours in Abluo App client code', () => {
  for (const file of CLIENT_DIRS.flatMap((d) => files(join(process.cwd(), d)))) {
    it(file.slice(process.cwd().length + 1), () => {
      const hits = readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => RAW_COLOUR.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      expect(hits.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([])
    })
  }
})

const CREATE_DIR = 'src/components/client/create'

describe('T3 — no dropdowns in the Create flow (ADR-025: cards, chips, toggles)', () => {
  let created: string[] = []
  try {
    created = files(join(process.cwd(), CREATE_DIR))
  } catch {
    created = [] // the Create components arrive in S2; the guard is armed already
  }
  it(`${CREATE_DIR} uses no <select> or Select component`, () => {
    const hits = created.filter((f) => /<select\b|<Select\b|from ['"][^'"]*\/select['"]/.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})
