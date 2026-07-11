# Context Pack — Sanity & Content Contracts

| | |
|---|---|
| **Pack version** | 1.0 |
| **Maturity / status** | Experimental / Active |
| **Owner** | sanity-content-contracts agent (supervised while Experimental) |
| **Consumers** | sanity-content-contracts agent; Orchestrator |
| **Reflects** | Playbook v1.0 · branch `dev` @ `b78dccc` |
| **Sources** | Playbook §3.3, §4 (example pack), §5.1–5.2, I5/I6 · ADR-001/004/009/010/011 · CLAUDE.md (Schema Evolution, Routable Content, Localization Rules, New Section Checklist) · repo inspection 2026-07-10 |

Inherits the Shared Context Spine (`../context-spine.md`). Additive only; never contradicts spine or accepted ADRs.

## Domain purpose
Own the content contract: Sanity schema, Studio configuration, GROQ queries, and hand-maintained types. Guarantee tenant scoping, schema↔GROQ↔type parity, and the routable-type pattern.

## Owned files & directories
- `src/lib/sanity/schema.ts` (135 KB monolith — all document/object types) — read+edit
- `src/lib/sanity/queries.ts`, `src/lib/sanity/types.ts` — read+edit
- `sanity.config.ts`, `src/lib/sanity/fields/*`, `src/lib/sanity/studio/**` — read+edit
- `src/sanity/**` (legacy dir: actions, components, client, queries, types — shimmed) — read+edit
- `src/lib/sanity/migrations/*` — read+edit (execution is `Tom decides`)
- `src/lib/modules/**` schema/manifest surface — read+edit for module schema tasks (§5.2)

## Excluded files & domains
- `src/components/**`, `src/app/[locale]/(website)/**` — frontend-sections agent; hand off component wiring
- `src/lib/sanity/design-system-resolver.ts`, `buildCssVars()`, DS merge logic — future Design System agent; only the `DS_FIELDS_SELECTION` projection itself lives here (ADR-004)
- `supabase/**`, `src/lib/supabase/*`, `src/app/api/**`, `proxy.ts` — future Supabase & Security agent
- `scripts/*`, `release.json` — release-engineering agent
- Release history, version conventions — not this domain's context (Playbook §4 exclusion example)

## Architectural invariants
| Invariant | Source |
|---|---|
| Every tenant-content GROQ query filters `&& projectSlug == $projectSlug`; `tenant_id` does not exist | ADR-001 · CLAUDE.md |
| `DS_FIELDS_SELECTION` is the only GROQ projection for DS fields | ADR-004 · CLAUDE.md |
| Routable document types satisfy the five-requirement checklist (localizedSlug + redirectFrom · three queries · route with redirect+slugMap · sitemap · migration) | CLAUDE.md Publicly Routable Content Pattern · Playbook gate 4 |
| Never change a populated field's type without inspecting stored data first (`*[defined(field)][0..5]`) | CLAUDE.md Schema Evolution Rules (MetricsSection incident) |
| User-facing fields are `localizedString/Text/PortableText/Slug` at creation time — never plain `string` converted later | CLAUDE.md Localization Rules |
| No animation/timing/easing data in content schemas | Playbook §11 · CLAUDE.md |
| Sections and Modules are orthogonal: schema for a section never owns managed collections | CLAUDE.md Sections vs Modules · Playbook §5.2 |
| Module manifests are declarative; `validateRegistry` must stay green | Playbook §5.2 · ADR-011 |
| Template-ID rule | `TEMPLATE_ID_RULE.md` |
| Content localization (siteConfig.supportedLocales, coalesce pattern) ≠ interface localization (next-intl) — never conflate | CLAUDE.md Localization Architecture |

## Applicable ADRs
- ADR-001 — projectSlug universal tenant identifier
- ADR-004 — DS_FIELDS_SELECTION single source of truth
- ADR-009 — Pages, Collections, and Modules
- ADR-010 — Module-Driven Studio Navigation
- ADR-011 — Module Management Architecture

## Relevant workflows (Playbook §5)
- §5.1 Create a new Section (schema/types/queries/preview steps)
- §5.2 Create a new Module (manifest, schema, registry validation)
- §5.4 Onboard a tenant (Sanity document creation steps)
- §5.5 Add a language (siteConfig.supportedLocales step)

## Mandatory quality gates
- Gate 1 Type + Gate 2 Test on every change; Gate 3 Build when schema affects build
- Gate 4 Contract-parity — **currently manual** (no codegen; I6): run the checklist explicitly and report it in handoff §6

## Known risks (P0-labelled)
- **Verified fact:** `schema.ts` is a single ~135 KB file spanning all domains (Phase 1 §9; confirmed present).
- **Verified fact:** dual Sanity dirs `src/sanity/` + `src/lib/sanity/` with shims (ls 2026-07-10; I5).
- **Verified fact:** legacy `homePage` type doubles section wiring (CLAUDE.md New Section Checklist; I5).
- **Verified fact:** types are hand-maintained; no Sanity typegen — parity is discipline, not a gate (Playbook I6).
- **Verified fact:** `post` type: schema complete, no route yet (CLAUDE.md routable table).

## Active backlog initiatives (Playbook §7)
- **I5** — schema split, retire `homePage`, collapse dual Sanity dir (ADR required — do not start unrequested)
- **I6** — Sanity typegen + parity-test generators (ADR advisable)

## Escalation conditions (beyond spine §10)
- Populated documents found before a field-type change → migration plan, `Tom approves`
- Any dataset mutation (publish/unpublish/patch of real content) → `Tom decides`
- A requested schema pattern with no ADR precedent → Architecture Review/ADR route

## Update & invalidation triggers
- Any accepted ADR touching content models · I5 or I6 landing · schema.ts restructuring · new routable type → regenerate pack, bump version.
