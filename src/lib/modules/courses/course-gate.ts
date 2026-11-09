// ── Courses — who may open a course page (ADR-045 D5 × ADR-040) ──────────────
//
// A course page takes the Access of the timetable pages that show the course:
//   • no published timetable page shows it   → open (the course page is its only place);
//   • any page that shows it is open, or opens for this visitor → open / granted;
//   • otherwise                                → denied (members only).
// So a site whose timetable is members-only (CYCE) gets members-only course
// pages without a second setting, and a public timetable keeps them public.
//
// Pure apart from the two injected reads, so every branch is unit-tested; the
// route wires the real ones (route.ts loadCourseGatePage + decideGateForRequest).

import { slugAncestorPaths } from '@/lib/access/policy'
import type { PageAccessFields, PageGate } from '@/lib/access/page-gate'
import { pagesShowingCourse, type PlacementPage } from './placement'

export type CourseGate =
  | { kind: 'open' }
  | { kind: 'granted' }
  /** `note`: the sign-in note of the first members-only timetable page (shown under the sign-in); `gate`: that page's decision (what the prompt may say about the visitor). */
  | { kind: 'denied'; note: unknown; gate: Extract<PageGate, { kind: 'denied' }> | null }

/** The timetable pages showing the course, each with the slug used for its path ancestors in this language. */
export function gatePagesFor(pages: readonly PlacementPage[], courseDocId: string, locale: string): { id: string; slug: string }[] {
  return pagesShowingCourse(pages, courseDocId).map((p) => ({
    id: p.id,
    // The home page has no path; a page without a slug in this language is checked with any of its slugs.
    slug: p.pageType === 'home' ? '' : (p.slugs[locale] ?? Object.values(p.slugs)[0] ?? ''),
  }))
}

export async function decideCourseGate(
  input: { pages: readonly PlacementPage[]; courseDocId: string; locale: string },
  deps: {
    /** The access fields of one page (null = unreadable → treated as closed). */
    readPage: (pageId: string, ancestorPaths: string[]) => Promise<(PageAccessFields & { accessPromptNote?: unknown }) | null>
    decide: (fields: PageAccessFields) => Promise<PageGate>
  },
): Promise<CourseGate> {
  const showing = gatePagesFor(input.pages, input.courseDocId, input.locale)
  if (showing.length === 0) return { kind: 'open' }
  let denied: Extract<CourseGate, { kind: 'denied' }> | null = null
  for (const page of showing) {
    const fields = await deps.readPage(page.id, page.slug ? slugAncestorPaths(page.slug) : [])
    if (!fields) {
      denied ??= { kind: 'denied', note: null, gate: null }
      continue
    }
    const gate = await deps.decide(fields)
    if (gate.kind === 'open') return { kind: 'open' }
    if (gate.kind === 'granted') return { kind: 'granted' }
    denied ??= { kind: 'denied', note: fields.accessPromptNote ?? null, gate }
  }
  return denied ?? { kind: 'denied', note: null, gate: null }
}
