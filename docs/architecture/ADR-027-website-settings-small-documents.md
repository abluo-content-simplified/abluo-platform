# ADR-027 — Website Settings split into small documents, one area at a time

- **Status:** Accepted (2026-10-06, Tom)
- **Related:** ADR-014 (one surface per setting), ADR-020 (module config), ADR-025 (client content editor), `docs/engineering/client-dashboard/cta-setup.md`

## Context
`siteConfig` is one large document: identity, SEO, languages, navigation, contact, footer and social. Every new website setting made it bigger. Each area added more groups, more validation, more chances of conflicting edits, and more of the document fetched by queries that need only one piece. The post call to action showed the problem: it is a list of rich, independently edited items, with references and their own validation. That fits a document per item better than an array deep inside `siteConfig`.

## Decision
- In Studio, **Website Settings** becomes a list, like Project Settings.
  - **General** is the existing `siteConfig` document, unchanged: one surface, and `AutoCreateSiteConfigAction` still bootstraps it.
  - Each further entry is an area stored as its own project-scoped document type: a `projectSlug` field, a `<type>ProjectOwned` initial value template, and a project-filtered document list.
- **Strangler approach.** We never do a big-bang migration.
  - **New areas are born separate.** The first is `callToAction` (Website Settings → Calls to action).
  - **Existing areas move one at a time:**
    1. The code reads the new document and falls back to the old `siteConfig` field.
    2. Copy the data.
    3. Verify on every website.
    4. Remove the fallback, then the old field.

    Never migrate data ahead of the code that reads it (see the 2026-08-14 outage).
- Small documents are project-scoped like content: queries filter on `projectSlug == $projectSlug` and exclude drafts on the website. References from content to them are **weak**, so an area can be deleted without being blocked by content that used it.

## Consequences
- Studio shows one short form per area. Edits to different areas never conflict. Queries fetch only the area they render.
- Website queries for a split area read a document type instead of a `siteConfig` sub-field. During a move, both shapes are read for a while.
- `siteConfig` shrinks over time. There is no fixed deadline; an area moves when there is a reason to touch it.
