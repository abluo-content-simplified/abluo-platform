# Context Pack — Frontend & Sections

| | |
|---|---|
| **Pack version** | 1.0 |
| **Maturity / status** | Experimental / Active |
| **Owner** | frontend-sections agent (supervised while Experimental) |
| **Consumers** | frontend-sections agent; Orchestrator |
| **Reflects** | Playbook v1.0 · branch `dev` @ `b78dccc` |
| **Sources** | Playbook §3.3, §5.1, I3/I5 · CLAUDE.md (Section/Pages Architecture, Motion Token Pipeline, Multilingual-First, New Section Checklist) · Phase 1 §9 · repo inspection 2026-07-10 |

Inherits the Shared Context Spine (`../context-spine.md`). Additive only; never contradicts spine or accepted ADRs.

## Domain purpose
Own presentation: section and website components, rendering paths, and animation choreography driven by design-system motion tokens.

## Owned files & directories
- `src/components/sections/*` (15 components as of 2026-07-10: Hero, Content, Text, Treatments, Team, FAQ, Contact, Form, Statement, Metrics, BlogListing, MediaContent, PhotoGallery, HeroLens, HeroLiveCapture) — read+edit
- `src/components/animation/*` (`SlideUp`, `FadeIn`, primitives) — read+edit
- `src/app/[locale]/(website)/**` — tenant routes, both SectionRenderers, website layout — read+edit
- `src/lib/sanity/types.ts`, `queries.ts`, `surfaces.ts` — **read only** (shapes consumed; edits belong to sanity-content-contracts)

## Excluded files & domains
- `src/lib/sanity/schema.ts`, `queries.ts`, `types.ts` (edits), Studio files — sanity-content-contracts agent
- `supabase/**`, RLS, migrations, `src/app/api/**`, `proxy.ts` — future Supabase & Security agent (explicit Playbook §4 exclusion: Frontend never receives Supabase context)
- `design-system-resolver.ts` merge logic — future Design System agent (consume tokens; don't redefine them)
- `scripts/*`, release tooling — release-engineering agent
- `(admin)/**`, `(client)/**` dashboards — no owner yet; escalate

## Architectural invariants
| Invariant | Source |
|---|---|
| Section component signature: `({ section, surface, designSystem })` | CLAUDE.md Section/Pages Architecture |
| Animations belong to components; duration/easing from `designSystem.motion` only; primitives `SlideUp`/`FadeIn`/`AnimatePresence`, never raw keyframes | CLAUDE.md Motion Token Pipeline · Playbook §11 |
| Token conventions: `durationSlower` hero entrance · `durationSlow` content entrances · `durationFast` UI interactions · `easingDecelerate` entrances | CLAUDE.md Motion conventions |
| New sections wired in **both** `[tenant]/page.tsx` and `[tenant]/[slug]/page.tsx` SectionRenderers, incl. duplicated hydration, until I5 lands | CLAUDE.md New Section Checklist (June 2026 routing-gap incident) |
| No `if (tenant === …)` branches; no hardcoded tenant/domain/locale values | Playbook P2 · CLAUDE.md Configuration Over Hardcoding |
| No hardcoded user-facing strings; locale dictionaries / Sanity content / config objects only | CLAUDE.md Multilingual-First |
| Sections present; Modules own data — never build a section that manages a collection | CLAUDE.md Sections vs Modules |
| Surfaces via `computeSectionSurface(...)`: `transparent`/`solid`/`glass` | CLAUDE.md Surfaces |

## Applicable ADRs
- ADR-002 — DS controls visual language; Site Settings controls business identity (consumption side)
- ADR-005 — every DS field has a downstream frontend consumer (this domain is the consumer)
- ADR-007 — every commit deployable

## Relevant workflows (Playbook §5)
- §5.1 Create a new Section (component + renderer registration steps)
- §5.6 Implement a feature / §5.7 Fix a bug (frontend slices)

## Mandatory quality gates
- Gate 1 Type + Gate 2 Test on every change; Gate 3 Build on renderer/layout changes
- Gate 5 Accessibility on every UI diff — **no Accessibility agent exists yet**: flag in handoff §9 as `Tom approves` escalation; never self-certify

## Known risks (P0-labelled)
- **Verified fact:** SectionRenderer + hydration duplicated across two route files — already caused one shipped incident (CLAUDE.md; Playbook I5).
- **Verified fact:** `if (tenantId === 'livener')` ~55-line branch in shared layout + `components/livener/*` as de-facto platform chrome (Playbook I3). Documented tech debt — do not extend it; do not remove it without the I3 ADR.
- **Verified fact:** animation primitives ignore `prefers-reduced-motion`; `<html lang="en">` hardcoded (Playbook I4). Fixes are I4-scoped work, not drive-by changes.

## Active backlog initiatives (Playbook §7)
- **I3** — tenant architecture unification (ADR required)
- **I5** — shared SectionRenderer extraction (ADR required)
- **I4 quick wins** — reduced-motion, `lang` — touch this domain when scheduled

## Escalation conditions (beyond spine §10)
- Task requires schema/GROQ/type edits → back to Orchestrator for sanity-content-contracts
- A DS token is missing for a needed value → Design System domain (unstaffed; escalate)
- Anything touching the Livener branch or tenant maps → I3 territory, `Tom approves` minimum

## Update & invalidation triggers
- I3/I4/I5 landing · new section type added · renderer architecture change · DS motion contract change → regenerate pack, bump version.
