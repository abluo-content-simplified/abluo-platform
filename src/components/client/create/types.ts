/**
 * Contract between the wizard shell (S2c) and its steps (S3+). Steps are
 * dumb: they render one question, read `draft`, and call `update()` with
 * S2b patch paths (`title.<loc>`, `subtitle.<loc>`, `body.<loc>`,
 * `categories`, …). The shell owns autosave, navigation and the SavePill.
 */
import type { PortableTextBlock } from '@portabletext/editor'
import type { WizardStep } from '@/lib/api/post-drafts'

export type DraftSnapshot = {
  /** Public draft id (uuid, without the `drafts.` prefix). */
  id: string
  rev: string
  title: Record<string, string>
  subtitle: Record<string, string>
  excerpt: Record<string, string>
  body: Record<string, PortableTextBlock[]>
  categories: string[]
  /** Cover image (a Media Library asset on `coverImage`), or null/absent when none. */
  cover?: { assetId: string; url: string; alt: Record<string, string>; focal?: { x: number; y: number } | null } | null
  step: WizardStep
  /** Furthest step reached in the first pass ('publish' or later → reopening shows the overview). */
  furthest?: WizardStep
  /** Call to action at the end of the post; null/absent = the site default. */
  cta?: { mode: 'default' | 'none' | 'custom'; ref: string | null } | null
  /** Gallery shown below the post (gallery id), null/absent = none. */
  gallery?: string | null
  /** FAQ sets shown below the post, in order (set ids, ADR-037). */
  faqSets?: string[]
  /** The post's FAQ heading per language; empty = the website default ("Frequently Asked Questions"). */
  faqTitle?: Record<string, string>
  faqSubtitle?: Record<string, string>
  /** 'edit' = unpublished changes to a live post ("Update post"); 'create' otherwise. */
  mode?: 'create' | 'edit'
  /** The published version, when there is one. */
  live?: { rev: string; publishedAt: string | null; expiresAt: string | null; archivedAt?: string | null; slugs: Record<string, string> } | null
  /** Edit mode: the copy differs from the live version (the Update bar shows only then). */
  hasChanges?: boolean
}

export type SiteInfo = {
  projectSlug: string
  /** The site's default content language — the language a post is written in first. */
  defaultLocale: string
  /** All site languages (one entry on single-language sites). */
  languages: string[]
  /** Blog categories configured for this site, labels in the viewer's language. */
  categories: { value: string; label: string }[]
  /** The same categories with every language's label and the colour — what the shared TermPicker takes. */
  categoryTerms?: { value: string; label: Record<string, string>; color: string | null }[]
  /** Holds blog.taxonomy.write: the category step offers "+ Add category". */
  canAddCategory?: boolean
  /** `https://<customDomain>` when the site has one, else null ("View on your site" is hidden). */
  origin?: string | null
  /** The site's IANA time zone: publication dates are shown and entered in it (ADR-032 D8). */
  timeZone?: string | null
  /** The project's callToAction documents (empty/absent = the CTA card is hidden). */
  /** This project's galleries — present only when the Gallery module is installed (may be empty). */
  galleries?: { id: string; title: string; count: number }[]
  /** This project's FAQ sets — present only with the FAQ module and faq.set.read (may be empty). */
  faqSets?: SiteFaqSet[]
  /** Holds faq.set.write: the FAQ sheet offers "Create new" and publishing offers "Publish the FAQ set too". */
  faqWrite?: boolean
  ctas?: { id: string; name: string; isDefault: boolean; heading: string | null; buttonLabel: string | null }[]
  /** The signed-in person's first name, for a friendlier message (null = unknown). */
  firstName?: string | null
}

/** One FAQ set as the post editor knows it (PostEditorFaqSet in post-drafts.ts). */
export type SiteFaqSet = {
  id: string
  name: string
  count: number
  /** draft = never published; changes = live with unpublished changes. */
  state: 'draft' | 'published' | 'changes' | 'archived'
  firstQuestions: string[]
}

export type StepProps = {
  draft: DraftSnapshot
  site: SiteInfo
  /** Content language being edited in this step. */
  locale: string
  /** Applies a change locally at once and queues it for autosave. */
  update: (set: Record<string, unknown>) => void
  goNext: () => void
  goBack: () => void
  /** A category created inline in this wizard: added to `site` so later steps (Review) show its name. */
  addCategory?: (term: { value: string; label: Record<string, string>; color: string | null }) => void
  /** A FAQ set created (or changed) from the post editor: added to `site.faqSets` so the step and overview show it. */
  upsertFaqSet?: (set: SiteFaqSet) => void
  /**
   * For steps that write through their OWN server action (e.g. Cover):
   * waits until every queued autosave is confirmed and returns the draft's
   * current revision (null when it couldn't be saved — offline / conflict).
   * Pass that rev to the action as its `ifRevisionId`.
   */
  flush?: () => Promise<string | null>
  /**
   * Tell the shell about a write a step made itself: the new revision (so the
   * next autosave doesn't report "edited elsewhere") and the changed snapshot
   * fields, e.g. `onServerWrite({ rev, cover })`.
   */
  onServerWrite?: (change: { rev: string } & Partial<Omit<DraftSnapshot, 'id' | 'rev'>>) => void
}
