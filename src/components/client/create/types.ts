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
  /** 'edit' = unpublished changes to a live post ("Update post"); 'create' otherwise. */
  mode?: 'create' | 'edit'
  /** The published version, when there is one. */
  live?: { rev: string; publishedAt: string | null; expiresAt: string | null; slugs: Record<string, string> } | null
}

export type SiteInfo = {
  projectSlug: string
  /** The site's default content language — the language a post is written in first. */
  defaultLocale: string
  /** All site languages (one entry on single-language sites). */
  languages: string[]
  /** Blog categories configured for this site, labels in the viewer's language. */
  categories: { value: string; label: string }[]
  /** `https://<customDomain>` when the site has one, else null ("View on your site" is hidden). */
  origin?: string | null
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
