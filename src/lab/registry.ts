import type { ComponentType } from 'react'

/**
 * The Component Lab registry — the one list of shared Abluo App components
 * (the client dashboard + the admin, ADR-030) that new screens must reuse.
 *
 * Rule (Tom, 2026-10-17): before building any dashboard UI, check this list.
 * If a component exists, use it. If none fits, say so and ask — do not build a
 * one-off. The Lab (`/lab`, super admin only) renders every entry live.
 *
 * Adding an entry: one object here + one demo file in `src/lab/demos/`.
 * `src/lab/__tests__/lab-guards.test.ts` checks every `source` exists and
 * exports `exports`, and that every component file in `src/components/app/ui`
 * is either here or in `NOT_IN_LAB_YET` with a reason.
 *
 * Copy here is admin-only (CLAUDE.md exemption), so it is plain English.
 */

export type LabCategory = 'primitive' | 'composite'
export type LabStatus = 'canonical' | 'legacy' | 'experimental'
export type LabTrait = 'dialog' | 'sheet' | 'menu' | 'toast' | 'keyboard' | 'selection'

export interface LabEntry {
  /** URL id: /lab/<id> */
  id: string
  /** The main component name. */
  name: string
  /** Every export this entry covers (checked against `source`). */
  exports: string[]
  /** Repo-relative path. */
  source: string
  category: LabCategory
  status: LabStatus
  traits?: LabTrait[]
  /** One sentence: what it is for. */
  summary: string
  /** Rules that are easy to break. */
  rules?: string[]
  /** What it replaces (ad-hoc patterns that must not come back). */
  replaces?: string[]
  /** The live demo — a dynamic import so demo code only loads when viewed. */
  demo: () => Promise<{ default: ComponentType }>
}

export const LAB_REGISTRY: LabEntry[] = [
  {
    id: 'button',
    name: 'Button',
    exports: ['Button', 'ButtonLink', 'IconButton'],
    source: 'src/components/app/ui/Button.tsx',
    category: 'primitive',
    status: 'canonical',
    summary: 'Every dashboard action: primary, secondary, quiet or destructive, in md (44px) or lg (48px); IconButton for icon-only actions.',
    rules: [
      'One primary action per view.',
      'type defaults to "button" — pass type="submit" explicitly.',
      'Use ButtonLink for navigation, never a Button with router.push.',
      'A disabled primary action must say why it is unavailable (Abluo UX rule).',
      'IconButton requires an aria-label — the icon is not a name.',
    ],
    replaces: ['PRIMARY_BTN / QUIET_BTN / SECONDARY_BTN constants', 'CAT_BUTTON, CAT_ICON_BUTTON, EVENT_BUTTON, PRIMARY_BUTTON', 'hand-written bg-action buttons'],
    demo: () => import('./demos/button.demo'),
  },
  {
    id: 'text-input',
    name: 'TextInput',
    exports: ['TextInput', 'TextArea'],
    source: 'src/components/app/ui/TextInput.tsx',
    category: 'primitive',
    status: 'canonical',
    summary: 'Single- and multi-line text fields for dashboard forms. Pair with FieldLabel and FieldError.',
    rules: ['lg (48px) in forms and sheets, md (44px) only for inline rows.', 'Dashboard only — website forms use src/components/fields.'],
    replaces: ['CAT_INPUT / EVENT_INPUT / INPUT class constants'],
    demo: () => import('./demos/text-input.demo'),
  },
  {
    id: 'field-label',
    name: 'FieldLabel',
    exports: ['FieldLabel', 'FieldError'],
    source: 'src/components/app/ui/FieldLabel.tsx',
    category: 'primitive',
    status: 'canonical',
    summary: 'The label (or legend) above a control, with optional hint, and the error slot below it.',
    replaces: ['CAT_LABEL / EVENT_LABEL'],
    demo: () => import('./demos/text-input.demo'),
  },
  {
    id: 'segmented-control',
    name: 'SegmentedControl',
    exports: ['SegmentedControl'],
    source: 'src/components/app/ui/SegmentedControl.tsx',
    category: 'primitive',
    status: 'canonical',
    traits: ['keyboard'],
    summary: 'One choice out of a few, inline: page tabs (solid) or filters (soft). Arrow keys move and select.',
    replaces: ['SegmentTabs, Segmented, FilterSegmented, SizeSwitch (migration pending)'],
    demo: () => import('./demos/segmented-control.demo'),
  },
  {
    id: 'pill',
    name: 'Pill',
    exports: ['Pill', 'CellPill'],
    source: 'src/components/app/ui/list/cells.tsx',
    category: 'primitive',
    status: 'canonical',
    summary: 'A small status or label chip in four tones. Domain pills (post status, gallery state…) map their status to a tone and render this.',
    rules: ['Keep the status → tone mapping in the module; only the look is shared.'],
    replaces: ['hand-built rounded-full status badges'],
    demo: () => import('./demos/pill.demo'),
  },
  {
    id: 'checkbox',
    name: 'Checkbox',
    exports: ['Checkbox'],
    source: 'src/components/app/ui/Checkbox.tsx',
    category: 'primitive',
    status: 'canonical',
    traits: ['selection'],
    summary: 'A square checkbox with a 44px hit area; chip variant for overlays on images.',
    rules: ['Checkboxes are square everywhere.', 'Use isShiftChange(e) for shift-click range selection in lists.'],
    demo: () => import('./demos/checkbox.demo'),
  },
  {
    id: 'switch',
    name: 'Switch',
    exports: ['Switch'],
    source: 'src/components/app/ui/Switch.tsx',
    category: 'primitive',
    status: 'canonical',
    summary: 'An on/off setting that takes effect immediately.',
    replaces: ['hand-built role="switch" buttons'],
    demo: () => import('./demos/switch.demo'),
  },
  {
    id: 'toast',
    name: 'Toast',
    exports: ['Toast'],
    source: 'src/components/app/ui/Toast.tsx',
    category: 'primitive',
    status: 'canonical',
    traits: ['toast'],
    summary: 'A short confirmation or error at the bottom of the screen, with an optional action (e.g. Undo).',
    demo: () => import('./demos/toast.demo'),
  },
  {
    id: 'empty-state',
    name: 'EmptyState',
    exports: ['EmptyState'],
    source: 'src/components/app/ui/EmptyState.tsx',
    category: 'primitive',
    status: 'canonical',
    summary: 'What a list or panel shows when there is nothing in it yet, with an optional next step.',
    demo: () => import('./demos/empty-state.demo'),
  },
  {
    id: 'page-header',
    name: 'PageHeader',
    exports: ['PageHeader'],
    source: 'src/components/app/ui/PageHeader.tsx',
    category: 'primitive',
    status: 'canonical',
    summary: 'The page title with its actions on the right. Every page sits in PageShell and starts with this.',
    demo: () => import('./demos/page-header.demo'),
  },
  {
    id: 'section-heading',
    name: 'SectionHeading',
    exports: ['SectionHeading'],
    source: 'src/components/app/ui/SectionHeading.tsx',
    category: 'primitive',
    status: 'canonical',
    summary: 'The heading of a block inside a page, with an optional "See all" link.',
    demo: () => import('./demos/section-heading.demo'),
  },
  {
    id: 'confirm-dialog',
    name: 'ConfirmDialog',
    exports: ['ConfirmDialog'],
    source: 'src/components/app/ui/ConfirmDialog.tsx',
    category: 'composite',
    status: 'canonical',
    traits: ['dialog'],
    summary: 'Asks before an irreversible action (discard, delete), with busy and error states.',
    rules: ['Only for irreversible actions — reversible ones get a Toast with Undo instead.'],
    demo: () => import('./demos/confirm-dialog.demo'),
  },
  {
    id: 'bottom-sheet',
    name: 'BottomSheet',
    exports: ['BottomSheet'],
    source: 'src/components/app/ui/BottomSheet.tsx',
    category: 'composite',
    status: 'canonical',
    traits: ['sheet', 'dialog'],
    summary: 'A panel that slides up from the bottom on phones (centred on desktop) for a short task or a list of choices.',
    demo: () => import('./demos/bottom-sheet.demo'),
  },
  {
    id: 'card-menu',
    name: 'CardMenu',
    exports: ['CardMenu'],
    source: 'src/components/app/ui/CardMenu.tsx',
    category: 'composite',
    status: 'canonical',
    traits: ['menu', 'keyboard'],
    summary: 'The "⋯" menu on a card or table row: default, cell (in a table) or chip (over an image).',
    demo: () => import('./demos/card-menu.demo'),
  },
]

/**
 * Component files in `src/components/app/ui` not in the Lab yet, each with a
 * reason. Phase 2 empties this list; the guard test fails on any file that is
 * in neither place, so a new shared component cannot be added silently.
 */
export const NOT_IN_LAB_YET: Record<string, string> = {
  'src/components/app/ui/AttentionList.tsx': 'Phase 2',
  'src/components/app/ui/Avatar.tsx': 'Phase 2',
  'src/components/app/ui/BarButton.tsx': 'Phase 2',
  'src/components/app/ui/ChoiceCard.tsx': 'Phase 2',
  'src/components/app/ui/DashboardGrid.tsx': 'Phase 2',
  'src/components/app/ui/DateRangePicker.tsx': 'Phase 2',
  'src/components/app/ui/Fab.tsx': 'Phase 2',
  'src/components/app/ui/FactRow.tsx': 'Phase 2',
  'src/components/app/ui/FilterBar.tsx': 'Phase 2',
  'src/components/app/ui/FilterSheet.tsx': 'Phase 2',
  'src/components/app/ui/LinkCard.tsx': 'Phase 2',
  'src/components/app/ui/ListToolbar.tsx': 'Phase 2',
  'src/components/app/ui/PageShell.tsx': 'Phase 2 (frame — documented on PageHeader)',
  'src/components/app/ui/RankedList.tsx': 'Phase 2',
  'src/components/app/ui/SelectionBar.tsx': 'Phase 2',
  'src/components/app/ui/SidePanel.tsx': 'Phase 2',
  'src/components/app/ui/Sparkline.tsx': 'Phase 2',
  'src/components/app/ui/StatGrid.tsx': 'Phase 2',
  'src/components/app/ui/StatTile.tsx': 'Phase 2',
  'src/components/app/ui/ToggleChips.tsx': 'Phase 2',
  'src/components/app/ui/TrendChart.tsx': 'Phase 2',
  'src/components/app/ui/UpdateCard.tsx': 'Phase 2',
  'src/components/app/ui/ViewSwitch.tsx': 'Phase 2 (to become a SegmentedControl configuration)',
  'src/components/app/ui/list/AutoGrid.tsx': 'Phase 2',
  'src/components/app/ui/list/ContentCard.tsx': 'Phase 2',
  'src/components/app/ui/list/DataTable.tsx': 'Phase 2',
  'src/components/app/ui/list/ThumbStrip.tsx': 'Phase 2',
  'src/components/app/ui/list/file-cells.tsx': 'Phase 2',
}

export function labEntry(id: string): LabEntry | undefined {
  return LAB_REGISTRY.find((e) => e.id === id)
}
