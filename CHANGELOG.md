# Changelog

This file tracks significant milestones and feature releases.
For technical build details, see the corresponding `build-log-V{version}.txt` in the repo root.

---

## V0.9.17 — ADR-010 Phase 1: Studio Information Architecture

**Studio — Project-specific editing experience**

The Studio now presents a clean, project-specific editing experience:

- **Unified Pages list** — all pages in one flat list regardless of schema type. No implementation details (schema names, document type folders) are exposed to editors.
- **Module-aware Collections** — each project shows only the Collections that belong to its enabled modules. Martegani sees Blog only. Livener sees Blog, Events, and Live.
- **Website Settings / Project Settings** — explicit separation between website configuration (`siteConfig`) and platform-level configuration (`project` document, including the new Modules section).
- **Project Settings always reachable** — the project document is now directly accessible from the Studio navigation. Global search is no longer required.

This establishes the foundation for ADR-011 (Module Management) without exposing Sanity schema internals to editors.

---

## V0.9.16 — ADR-009: Pages, Collections, and Modules

**Studio — Information architecture foundation**

Established the conceptual model that governs all future Studio navigation:

- **Pages own presentation. Collections own data. Modules own capabilities.**
- Every public route now has exactly one editable Page document in Sanity.
- `blogPage` singleton introduced — Blog route hero, subtitle, and SEO are now Sanity-managed rather than hardcoded TypeScript strings.
- Collections grouped by module (Blog sub-group, Events sub-group) rather than a flat list.
- Studio navigation renamed for clarity: "Posts" instead of "Blog Posts".

---

## V0.9.1 — Tenant Membership

Role-based access control foundation: `tenant_members` table, owner/editor/viewer roles, SECURITY DEFINER RLS, permissions layer.

---

## V0.8.0 — Design System Assignment Flow

Design System Picker, `DesignSystemAssignPane`, `ProjectLinker`, and `AutoCreateSiteConfigAction` (auto-bootstraps a minimal `siteConfig` on first project publish).

---

## V0.7.0 — Publicly Routable Content Pattern

`localizedSlug` on all routable document types, `redirectFrom` support, `SlugMapProvider`, hreflang alternates, sitemap. The five-requirement checklist for routable content formalised in `CLAUDE.md`.
