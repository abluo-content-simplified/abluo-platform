/**
 * Design System fields must be read by the website — source guard
 *
 * WHY THIS TEST EXISTS
 * Until 2026-09-29 several Design System settings could be edited in Studio and
 * saved in Sanity while no website code ever read them: section padding, the
 * Body text scale, max text width, spacing, cards, shadows, some navigation
 * radii, background assets. Editors changed them and nothing happened; two
 * design systems even carried values that looked authoritative but described
 * nothing on screen. This guard stops a new field from joining that list
 * silently.
 *
 * HOW IT WORKS (a tripwire, not a proof)
 * Every leaf of `DS_FIELDS_SELECTION` — the single GROQ projection for design
 * system fields — is looked up in the website's runtime source (src/app,
 * src/components, src/lib, excluding the schema, the query, the inheritance
 * resolver, type declarations, Studio code and tests). A leaf counts as read
 * when one runtime file accesses the leaf as a property (`.leaf` / `?.leaf`) or
 * destructures it, and that same file also mentions its group. That can
 * over-count (two unrelated properties sharing a name in one file), so a pass
 * is not proof of use — but a failure always means nobody reads the field.
 *
 * WHAT TO DO WHEN IT FAILS
 * - "not read": you added a Design System field that nothing renders. Wire it
 *   (and give today's look as the fallback, so no site moves), remove it, or —
 *   if it is deliberately not built yet — add it to NOT_YET_READ with a reason.
 * - "now read": a field in NOT_YET_READ is read now. Delete it from the list.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DS_FIELDS_SELECTION } from '../queries'

const ROOT = join(__dirname, '..', '..', '..', '..')

/** Studio metadata and inheritance plumbing — not visual settings. */
const META = new Set(['_id', 'name', 'role', 'description', 'parentDesignSystem'])

/**
 * Known backlog: fields editors can set that the website does not render yet.
 * Each needs a decision — wire it (today's look as the fallback) or remove it.
 */
const NOT_YET_READ: Record<string, string> = {
  'colors.darkTheme.accent': 'Accent colour is merged but never emitted as a CSS variable; components use primary.',
  'colors.lightTheme.accent': 'Same as the dark theme accent.',
  'spacing.xs': 'Spacing scale (xs–xl) is not emitted; components use Tailwind spacing.',
  'spacing.m': 'Spacing scale — see spacing.xs.',
  'spacing.l': 'Spacing scale — see spacing.xs.',
  'spacing.xl': 'Spacing scale — see spacing.xs.',
  'backgroundAssets.key': 'Background assets are merged by key but never rendered.',
  'backgroundAssets.name': 'Background assets — see backgroundAssets.key.',
  'backgroundAssets.lightImage.asset': 'Background assets — see backgroundAssets.key.',
  'backgroundAssets.darkImage.asset': 'Background assets — see backgroundAssets.key.',
  'navigation.menuRadius': 'Navigation radii, gap and dropdown style are not used by the header.',
  'navigation.dropdownStyle': 'See navigation.menuRadius (only mentioned in a comment in the tenant layout).',
  'navigation.menuGap': 'See navigation.menuRadius.',
  'navigation.dropdownRadius': 'See navigation.menuRadius.',
  'cardVariants.key': 'Card variants are merged but no section offers a variant picker.',
  'cardVariants.label': 'See cardVariants.key.',
  'cardVariants.lightTheme.background': 'See cardVariants.key.',
  'cardVariants.lightTheme.border': 'See cardVariants.key.',
  'cardVariants.darkTheme.background': 'See cardVariants.key.',
  'cardVariants.darkTheme.border': 'See cardVariants.key.',
  'shadows.card': 'Shadows are not emitted; cards use Tailwind shadows.',
  'shadows.dropdown': 'See shadows.card.',
  'shadows.modal': 'See shadows.card.',
  'layout.maxTextWidth': 'Readable text width is fixed per component (max-w-*), not read from here.',
  'layout.sectionPaddingYCompact': 'No section has a "compact" spacing option yet; Normal (sectionPaddingY) is wired.',
  'layout.sectionPaddingYLarge': 'No section has a "large" spacing option yet; Normal (sectionPaddingY) is wired.',
  'mediaStyles.label': 'Studio label for the style picker — not a visual value.',
}

/**
 * CSS variables the tenant layout emits that no stylesheet or component reads.
 * Same rule: wire them or drop them, and keep this list honest.
 */
const EMITTED_NOT_YET_USED: Record<string, string> = {
  '--color-warning': 'No component shows a warning state on the website yet.',
  '--font-size-body': 'Body size reaches text via --text-base (Tailwind); this alias has no reader.',
  '--font-size-body-large': 'Body large is emitted but no component reads it (text-lg is fixed).',
  '--font-size-small': 'Small is emitted but no component reads it (text-sm is fixed).',
  '--typo-h1': 'Legacy shorthand bundle; headings read the per-property --font-size-h1 etc.',
  '--typo-h2': 'See --typo-h1.',
  '--typo-h3': 'See --typo-h1.',
  '--typo-h4': 'See --typo-h1.',
  '--typo-body': 'See --typo-h1.',
  '--typo-body-large': 'See --typo-h1.',
  '--typo-small': 'See --typo-h1.',
  '--motion-duration-base': 'Animations read designSystem.motion in JS (see CLAUDE.md); the CSS copy is unused.',
  '--motion-duration-slow': 'See --motion-duration-base.',
  '--motion-duration-slower': 'See --motion-duration-base.',
  '--motion-easing-accelerate': 'See --motion-duration-base.',
  '--motion-easing-decelerate': 'See --motion-duration-base.',
  '--motion-easing-emphasized': 'See --motion-duration-base.',
}

/** Tailwind theme variables: read by the generated utilities, not by our source. */
const TAILWIND_THEME_VARS = new Set(['--text-base', '--leading-relaxed'])

/** Leaf paths of a GROQ projection like `{ a, b { c, d }, e[] { f } }`. */
function leafPaths(projection: string): string[] {
  const src = projection
    .replace(/\/\/[^\n]*/g, '')
    .replace(/->/g, '')
    .replace(/\[\]/g, '')
  const out: string[] = []
  const stack: string[] = []
  let token = ''
  const flush = () => {
    const name = token.trim()
    token = ''
    return name
  }
  for (const ch of src) {
    if (ch === '{') {
      const name = flush()
      if (name) stack.push(name)
      else if (stack.length === 0) stack.push('')
      else stack.push(name)
    } else if (ch === '}') {
      const name = flush()
      if (name) out.push([...stack, name].filter(Boolean).join('.'))
      stack.pop()
    } else if (ch === ',') {
      const name = flush()
      if (name) out.push([...stack, name].filter(Boolean).join('.'))
    } else {
      token += ch
    }
  }
  return out.filter((p) => !META.has(p.split('.')[0]))
}

const EXCLUDE = [
  /\/__tests__\//,
  /\.test\.tsx?$/,
  /src\/lib\/sanity\/schema\.ts$/,
  /src\/lib\/sanity\/queries\.ts$/,
  /src\/lib\/sanity\/design-system-resolver\.ts$/,
  /src\/lib\/sanity\/types\.ts$/,
  /src\/sanity\//,
  /src\/lib\/sanity\/actions\//,
  /\.d\.ts$/,
]

function runtimeFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) runtimeFiles(full, acc)
    else if (/\.(ts|tsx)$/.test(name) && !EXCLUDE.some((re) => re.test(full))) acc.push(full)
  }
  return acc
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

const sources = ['src/app', 'src/components', 'src/lib']
  .flatMap((d) => runtimeFiles(join(ROOT, d)))
  // Comments are stripped: a field named in a comment is not a field read.
  .map((f) => ({ file: relative(ROOT, f), text: stripComments(readFileSync(f, 'utf8')) }))

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function isRead(path: string): boolean {
  const parts = path.split('.')
  const leaf = parts[parts.length - 1]
  const group = parts[0]
  const leafRe = new RegExp(`(?:\\?\\.|\\.)${esc(leaf)}\\b|[{,]\\s*${esc(leaf)}\\s*[,}:=]`)
  const groupRe = new RegExp(`\\b${esc(group)}\\b`)
  return sources.some(
    ({ file, text }) => leafRe.test(text) && (parts.length === 1 || groupRe.test(text) || file.includes(group)),
  )
}

const paths = leafPaths(DS_FIELDS_SELECTION)

describe('Design System fields are read by the website', () => {
  it('parses the projection', () => {
    expect(paths.length).toBeGreaterThan(50)
    expect(paths).toContain('layout.sectionPaddingY')
    expect(paths).toContain('typography.body.lineHeight')
  })

  it('every field is read, or listed in NOT_YET_READ with a reason', () => {
    const unread = paths.filter((p) => !isRead(p) && !(p in NOT_YET_READ))
    expect(unread, `not read by any website code:\n  ${unread.join('\n  ')}`).toEqual([])
  })

  it('NOT_YET_READ lists only fields that are still unread', () => {
    const nowRead = Object.keys(NOT_YET_READ).filter((p) => isRead(p))
    expect(nowRead, `now read — remove from NOT_YET_READ:\n  ${nowRead.join('\n  ')}`).toEqual([])
  })

  it('NOT_YET_READ names only real fields', () => {
    const unknown = Object.keys(NOT_YET_READ).filter((p) => !paths.includes(p))
    expect(unknown).toEqual([])
  })

  it('every emitted CSS variable is used, or listed in EMITTED_NOT_YET_USED', () => {
    const emitters = [
      join(ROOT, 'src/app/[locale]/(website)/[tenant]/layout.tsx'),
      ...readdirSync(join(ROOT, 'src/lib/design-system'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(ROOT, 'src/lib/design-system', f)),
    ]
    const emitted = new Set(
      emitters.flatMap((f) => readFileSync(f, 'utf8').match(/--[a-z0-9-]+(?=:)/g) ?? []),
    )
    const css = sources.map((s) => s.text).join('\n') + readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8')
    const unused = [...emitted].filter(
      (v) => !TAILWIND_THEME_VARS.has(v) && !(v in EMITTED_NOT_YET_USED) && !css.includes(`var(${v}`),
    )
    expect(unused, `emitted but never used:\n  ${unused.join('\n  ')}`).toEqual([])
    const nowUsed = Object.keys(EMITTED_NOT_YET_USED).filter((v) => css.includes(`var(${v}`))
    expect(nowUsed, `now used — remove from EMITTED_NOT_YET_USED:\n  ${nowUsed.join('\n  ')}`).toEqual([])
  })

  it('reads the two settings wired on 2026-09-29', () => {
    expect(isRead('layout.sectionPaddingY')).toBe(true)
    expect(isRead('typography.body.lineHeight')).toBe(true)
    expect(isRead('typography.body.weight')).toBe(true)
  })
})
