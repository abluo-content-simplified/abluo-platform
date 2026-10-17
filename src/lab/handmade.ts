/**
 * The "hand-made UI" scan (Component Lab, Tom 2026-10-17): dashboard code may
 * not build its own buttons, fields, switches, tabs, dialogs, boxes, pills or
 * loading blocks — those exist as shared components in src/components/app.
 *
 * `scanHandmade()` counts each pattern per file. The guard test compares the
 * counts with `handmade-baseline.json` (the shrinking "still to do" list the
 * Lab shows at /lab/todo): a file may never go UP, a file not in the list must
 * be at zero, and when a file goes DOWN the list must be refreshed
 * (`npm run lab:baseline`) so it stays true. When the list is empty, every
 * dashboard screen is built from the shared components.
 *
 * Pure apart from reading files; no network, no writes.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** Dashboard code: both Abluo App surfaces and the signed-out pages. The shared layer (src/components/app) is the one place allowed to contain these patterns. */
export const HANDMADE_SCOPE = [
  'src/components/client',
  'src/components/admin',
  'src/components/auth',
  'src/app/[locale]/(client)',
  'src/app/[locale]/(admin)',
  'src/app/(platform)/(auth)',
]

export const HANDMADE_RULES = {
  button: { re: /<button\b/g, use: 'Button, IconButton, BarButton, LinkCard, ChoiceCard' },
  styleConstant: { re: /\bconst [A-Z][A-Z0-9_]*(?:BTN|BUTTON|INPUT|LABEL|TEXTAREA|SELECT|CONTROL)[A-Z0-9_]*\s*=/g, use: 'Button, TextInput, FieldLabel, Select' },
  input: { re: /<input\b(?![^>]*\btype=["'](?:hidden|file)["'])/g, use: 'TextInput, DateInput, Checkbox, Field' },
  textarea: { re: /<textarea\b/g, use: 'TextArea' },
  select: { re: /<select\b/g, use: 'Select, FilterSelect' },
  switchOrTabs: { re: /role=["'](?:switch|radiogroup|tablist)["']/g, use: 'Switch, SegmentedControl, ViewSwitch' },
  dialog: { re: /<dialog\b/g, use: 'BottomSheet, SidePanel, ConfirmDialog' },
  box: { re: /\brounded-2xl border\b/g, use: 'Panel, Notice, EmptyState' },
  pill: { re: /\brounded-full\b[^"'`]*\btext-xs\b/g, use: 'Pill, LifecycleBadge' },
  pulse: { re: /\banimate-pulse\b/g, use: 'Skeleton' },
  backLink: { re: /-ml-1 inline-flex min-h-11 items-center gap-1\b/g, use: 'BackLink' },
} as const

export type HandmadeRule = keyof typeof HANDMADE_RULES
export type HandmadeCounts = Record<string, Partial<Record<HandmadeRule, number>>>

function files(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : files(full)
    return /\.tsx$/.test(name) ? [full] : []
  })
}

/** Counts per file (repo-relative path), only files with at least one hit. Comment lines are ignored. */
export function scanHandmade(root: string): HandmadeCounts {
  const out: HandmadeCounts = {}
  for (const file of HANDMADE_SCOPE.flatMap((d) => files(path.join(root, d))).sort()) {
    const src = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    const counts: Partial<Record<HandmadeRule, number>> = {}
    for (const [rule, { re }] of Object.entries(HANDMADE_RULES) as [HandmadeRule, { re: RegExp }][]) {
      const n = src.match(re)?.length ?? 0
      if (n) counts[rule] = n
    }
    if (Object.keys(counts).length) out[path.relative(root, file)] = counts
  }
  return out
}
