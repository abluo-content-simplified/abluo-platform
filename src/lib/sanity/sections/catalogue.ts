// ── Section catalogue ─────────────────────────────────────────────────────────
//
// How the Studio's "Add section" picker presents every section type: which
// group it sits in, the one line that says what it is for, and whether it is
// still under review. Pure data — no React, no Sanity imports — so the schema,
// the Studio picker and the tests can all read it.
//
// Every type in PAGE_SECTIONS_OF must have an entry here; a test fails
// otherwise (src/lib/sanity/sections/__tests__/catalogue.test.ts), so a new
// section can never land in the picker unlabelled.
//
// Studio is admin-only, so the copy is English (CLAUDE.md localization
// exceptions: "Admin-only interfaces, Sanity Studio utilities").
//
// Module gating is NOT declared here: which module owns a section comes from
// each manifest's platformContract.sectionTypes (MODULE_REGISTRY), the one
// source of truth the website renderer already uses.

export type SectionGroupId = 'openers' | 'story' | 'offer' | 'proof' | 'modules' | 'contact' | 'review'

export interface SectionGroup {
  id: SectionGroupId
  title: string
  /** One line under the group heading in the picker. */
  hint: string
}

/** Picker order. */
export const SECTION_GROUPS: SectionGroup[] = [
  { id: 'openers', title: 'Openers', hint: 'The first thing visitors see at the top of a page.' },
  { id: 'story', title: 'Story', hint: 'Text, images and video that tell who you are.' },
  { id: 'offer', title: 'Offer', hint: 'What you do — services, features, how it works.' },
  { id: 'proof', title: 'People & Proof', hint: 'The team and the numbers behind the work.' },
  { id: 'modules', title: 'From Your Modules', hint: 'Lists that fill themselves from a module — posts, events, galleries.' },
  { id: 'contact', title: 'Get in Touch', hint: 'Contact details, maps, forms and calls to action.' },
  { id: 'review', title: 'Under Review', hint: 'Built for one site — kept here until we decide if they become general.' },
]

export interface SectionCatalogueEntry {
  group: SectionGroupId
  /** One short sentence: what the section is for, in the visitor's terms. */
  description: string
}

export const SECTION_CATALOGUE: Record<string, SectionCatalogueEntry> = {
  // Openers
  heroSection: { group: 'openers', description: 'Big headline, short intro and buttons, with an optional image or video.' },
  heroLensSection: { group: 'openers', description: 'Headline beside a round image with a phone held in front of it.' },
  heroLiveCaptureSection: { group: 'openers', description: 'Headline over an event photo, with a phone showing the live screen.' },

  // Story
  textSection: { group: 'story', description: 'A title and running text — for longer explanations.' },
  statementSection: { group: 'story', description: 'One strong sentence on its own, with an optional image beside it.' },
  contentSection: { group: 'story', description: 'Text and buttons beside an image or video.' },
  mediaFeatureSection: { group: 'story', description: 'An image beside a short list of features, each with a title and line.' },
  videoSection: { group: 'story', description: 'One video, full width (loads after cookie consent).' },

  // Offer
  treatmentsSection: { group: 'offer', description: 'Your services or treatments, each with a name, tagline and text.' },
  featureGridSection: { group: 'offer', description: 'A grid of cards — features, benefits or reasons to choose you.' },
  stepsSection: { group: 'offer', description: 'How it works, as numbered steps, with a closing line and button.' },
  categoryListSection: { group: 'offer', description: 'A list of categories with links, and an optional callout bar.' },
  priceListSection: { group: 'offer', description: 'Prices in a clear list, with optional per-month amounts, rate cards and small print.' },

  // People & proof
  teamSection: { group: 'proof', description: 'The people behind the practice, with photo and role.' },
  metricsSection: { group: 'proof', description: 'A row of key numbers — years, clients, results.' },

  // From your modules
  blogListingSection: { group: 'modules', description: 'The latest blog posts, or a hand-picked selection.' },
  eventsListingSection: { group: 'modules', description: 'Upcoming or past events as a list.' },
  liveLatestSection: { group: 'modules', description: 'The live event happening now, or the next one coming up.' },
  photoGallerySection: { group: 'modules', description: 'One or more photo galleries, with tabs and a full-screen viewer.' },
  faqSection: { group: 'modules', description: 'Frequently asked questions that open and close.' },
  catalogueListingSection: { group: 'modules', description: 'Items from your catalogue or menu, with prices if you want them.' },
  downloadSection: { group: 'modules', description: 'Documents to view or download — the ones the site placed on this page in the dashboard.' },

  // Get in touch
  contactSection: { group: 'contact', description: 'Phone, email and address, with an optional map and message button.' },
  locationsSection: { group: 'contact', description: 'Your addresses as cards or a list, each with a small map and a Google Maps link.' },
  formSection: { group: 'contact', description: 'A form shown directly on the page.' },
  formOverlayButtonSection: { group: 'contact', description: 'A button that opens a form in a panel above the page.' },
  ctaBannerSection: { group: 'contact', description: 'A bold banner with a heading and one or two buttons.' },

  // Under review — built for tmz.it
  ventureListSection: { group: 'review', description: 'Rows of ventures or projects, each with a status. Built for tmz.it.' },
  clientsFlowSection: { group: 'review', description: 'Client names set as one flowing block of text. Built for tmz.it.' },
  careerTimelineSection: { group: 'review', description: 'Roles over time, as a timeline. Built for tmz.it.' },
}

/** The insert-menu groups for Sanity's built-in menu (Add before / after). */
export function insertMenuGroups(types: string[]): Array<{ name: string; title: string; of: string[] }> {
  return SECTION_GROUPS.map((g) => ({
    name: g.id,
    title: g.title,
    of: types.filter((t) => SECTION_CATALOGUE[t]?.group === g.id),
  })).filter((g) => g.of.length > 0)
}

/**
 * Which section types to offer for a project.
 *
 * - Platform sections (owned by no module) are always offered.
 * - A module's sections are offered only when that module is installed.
 * - `installed === null` means "unknown" (no project, query failed): offer
 *   everything — the website renderer still gates, so this fails open safely.
 * - Types already used in the array are always kept, so an existing section
 *   never turns into "invalid type" in the editor.
 */
export function offeredSectionTypes(
  types: string[],
  sectionOwner: Record<string, string>,
  installed: Set<string> | null,
  used: Set<string> = new Set(),
): string[] {
  if (installed === null) return types
  return types.filter((t) => {
    const owner = sectionOwner[t]
    return !owner || installed.has(owner) || used.has(t)
  })
}

/**
 * section type → owning module id, from each manifest's
 * platformContract.sectionTypes. Takes the registry as an argument so this
 * file never imports it (the registry imports the module schemas, which import
 * the shared sections list — a static import here would be a cycle).
 */
export function sectionOwnerMap(
  registry: ReadonlyArray<{ id: string; platformContract: { sectionTypes: readonly string[] } }>,
): Record<string, string> {
  const owner: Record<string, string> = {}
  for (const m of registry) for (const t of m.platformContract.sectionTypes) owner[t] = m.id
  return owner
}
