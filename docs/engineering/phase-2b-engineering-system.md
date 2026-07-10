# Abluo Engineering System — Phase 2B: Engineering Operating System & Future Architecture
**Date:** 2026-07-10
**Status:** Historical — superseded by [Engineering Playbook v1.0](./engineering-playbook.md) on 2026-07-10; retained as origin document, content below is unmodified from the original blueprint
**Basis:** [Phase 1 Discovery](./phase-1-discovery.md) · [Phase 2A Technical Audit](./phase-2a-technical-audit.md) · [API Auth Verification](./phase-2a-api-verification.md)
**Nature:** Strategic. No code or documentation was modified to produce this document.

> This is the foundation document for how Abluo is engineered, reviewed, released, and maintained — and for the orchestrator + specialist-agent system that will do most of that work. It is written to be *implemented*, not admired. Where it references a defect, the evidence lives in Phase 2A; it is not repeated here.

---

## 0. The one-paragraph thesis

Abluo is a solo-owned, AI-operated, multi-tenant platform. Its real engineering constraint is not headcount or compute — it is **context integrity across sessions**. Every serious defect found in Phase 2A (version split-brain, the `if (tenantId === 'livener')` branch, the manual 5-step Design System checklist, the routing gap that shipped, doc drift in `CLAUDE.md`) is the same failure: *knowledge that lived in a human's head or a checklist instead of in an enforced system.* The engineering operating system below exists to move that knowledge into **executable gates, typed contracts, and clearly-scoped agents** so that a cold-started AI session cannot violate an invariant without a machine noticing. We evolve; we do not rewrite. The architecture is sound — the *operating system around it* is what we are building.

---

## 1. Engineering Vision

### Guiding principles
1. **Invariants are enforced, not remembered.** If a rule matters (tenant scoping, DS field parity, alt text, version format), a test/type/lint/CI gate enforces it. Documentation describes; it never guards.
2. **The platform has no tenants in its code.** Tenant-specific behavior lives in data (Sanity `siteConfig`/`project`), never in `if (tenant === …)`. The 11th tenant must cost zero code.
3. **Contracts over conventions.** Schema → GROQ → Types is a typed pipeline, not a discipline. Drift is a build failure, not an incident.
4. **Small, sharp context.** Each unit of work — human or agent — carries the minimum context needed and the maximum context reuse. A cold session is the default; the system makes it safe.
5. **Accessible and secure by default.** The easy path produces an accessible, secure result. Getting it wrong requires effort and trips a gate.
6. **Every commit is deployable.** (ADR-007, kept.) Phased work leaves the platform green at each step.
7. **Evolution over rewrite.** Preserve what works: the module registry, DS inheritance, the ADR discipline, the three-stage release flow.

### Engineering values
- **Truthful state.** Deployed version, test status, and docs always tell the truth. A green badge means green.
- **Reversibility.** Every change has a known rollback. Backups are rehearsed, not hoped for.
- **Editor calm.** Complexity is absorbed by the platform, never exported to the client. (Core product promise — non-negotiable.)
- **Legible history.** One authoritative doc per concern; superseded material is marked, not deleted-in-place or duplicated.

### What Abluo optimizes for
Long-term maintainability by a very small team + AI · onboarding a new tenant with near-zero code · release confidence · consistent design and accessibility across all tenants · low token cost per unit of engineering work.

### What Abluo intentionally avoids
Enterprise process for its own sake · premature microservices/multi-repo · bespoke per-tenant code paths · CMS complexity leaking to clients · agent sprawl without clear ownership · hand-maintained parallel sources of truth (the root cause pattern of Phase 2A).

---

## 2. Engineering Operating System

The lifecycle, and the gates that make it trustworthy. Gates marked **[AUTO]** are machine-enforced (CI/local script); **[AGENT]** are performed by a specialist agent; **[HUMAN]** require Tom.

```
 PLAN ──► IMPLEMENT ──► REVIEW ──► VERIFY ──► RELEASE ──► DEPLOY ──► POST-DEPLOY
  │           │            │          │           │          │            │
 ADR?      typed       domain +    tsc+test+   version    dev→prev→    live
 scope     contracts   a11y +      a11y+build  integrity  main w/      smoke +
 (HUMAN)   (AGENT)     security    (AUTO)      (AUTO)     STOP gates   truth-check
                       (AGENT)                            (HUMAN)      (AUTO+AGENT)
```

### Stage definitions & mandatory gates

| Stage | What happens | Mandatory gates | Owner |
|---|---|---|---|
| **Plan** | Frame the change; decide if it needs an ADR (architecture-affecting) or is bounded implementation | ADR created & **Accepted** before architectural change **[HUMAN]**; else a one-line intent in the task | Orchestrator + Tom |
| **Implement** | Build against typed contracts; follow the relevant workflow (§4) | Work touches only its declared scope; new user-facing strings localized; no `if (tenant===…)` **[AGENT review]** | Specialist agent |
| **Review** | Domain review + cross-cutting review | Domain agent sign-off; **Accessibility gate** for any UI; **Security gate** for any API/DB/auth change **[AGENT]** | Specialist + Accessibility/Security agents |
| **Verify** | Automated correctness | `tsc --noEmit` clean · `vitest run` all green · `next build` clean · a11y lint clean · contract-parity tests green **[AUTO]** | CI / `doctor.sh` |
| **Release** | Cut a version | **Version-integrity gate**: single format, tag created, `release.json`+`package.json` synced, tests green at HEAD **[AUTO]** | Release agent + Tom |
| **Deploy** | dev → preview → main | Literal **STOP** at dev and preview; explicit human approval each hop (ADR-007 / CLAUDE.md) **[HUMAN]** | Tom |
| **Post-deploy** | Confirm reality matches intent | Live version endpoint == released tag · smoke of critical routes · no new runtime errors **[AUTO+AGENT]** | Release agent |

### Mandatory quality gates (the non-negotiable seven)
1. **Type gate** — `tsc --noEmit` clean.
2. **Test gate** — `vitest run` fully green (no flaky timeouts tolerated; see Backlog Critical).
3. **Build gate** — deterministic `rm -rf .next && next build` clean.
4. **Contract-parity gate** — every DS field appears in schema *and* `DS_FIELDS_SELECTION` *and* merge logic *and* CSS var *and* a test; every routable type satisfies the 5-requirement checklist. Enforced by generated tests, not by humans reading CLAUDE.md.
5. **Accessibility gate** — a11y lint (jsx-a11y) clean; `lang` correct; reduced-motion respected; interactive components meet the component a11y contract (§7).
6. **Security gate** — no mutating API route without an auth check; no service-role client reachable unauthenticated; no secret material in responses.
7. **Version-integrity gate** — one tag format; HEAD tag == pipeline-reported version == `package.json`.

### Automation opportunities (highest leverage first)
- **CI on push to `dev`** running gates 1–6 (currently only local `doctor.sh`/`release.sh` — no CI per Phase 1). This single change would have caught the shipped routing gap, the 2 flaky tests, and version drift.
- **Sanity typegen** to make gate 4 real (schema↔type drift becomes a compile error).
- **Parity test generators** for DS fields and routable types (turn the two CLAUDE.md checklists into tests).
- **Post-deploy truth-check** hitting `/api/version` and comparing to the released tag.

---

## 3. AI Engineering Strategy

### 3.1 Model of operation
One **Orchestrator** (strong model) plans, routes, holds cross-cutting invariants, synthesizes, and escalates to Tom. **Specialist agents** (mostly cheaper models) do bounded work inside one domain with a small, reusable context pack. **Architecture Review** and **final acceptance** use a strong model and/or Tom.

Design objective (per the brief): not fewest agents — **clearest ownership, lowest token cost, most reusable context, most consistent quality.** Agents are drawn on the real architectural boundaries found in Phase 1 §9, because those boundaries are exactly where invariants and recurring checklists live.

### 3.2 The orchestrator

| Responsibility | Detail |
|---|---|
| Planning & routing | Decompose a request into domain tasks; pick the specialist(s); decide ADR-needed. |
| Cross-cutting invariants | Owns the rules that span domains: "no tenant hardcoding", "every commit deployable", "user-facing strings localized", the deploy STOP gates. |
| Context ownership | Owns the **shared context spine** (§3.5) and hands each specialist only its pack + the task. |
| Synthesis | Merges specialist outputs into one coherent change and one narrative for Tom. |
| Escalation | Routes genuine decisions (architecture, security tradeoffs, production promotion, version cut) to Tom. Never decides these silently. |
| Quality backstop | Ensures the seven gates ran; refuses to advance a stage if a gate is red. |

### 3.3 Specialist agents (recommended set)

Ten specialists. Each entry: scope, primary files, model tier, and the invariants it guards.

| Agent | Owns (scope) | Primary files | Model tier | Guards |
|---|---|---|---|---|
| **Frontend/Sections** | Section & website components, rendering, animation choreography | `src/components/sections/*`, `src/components/animation/*`, `(website)/**` | Cheap | New Section Checklist wiring; single shared SectionRenderer; animation via DS tokens only |
| **Design System** | Tokens, inheritance, merge, CSS-var emission, motion | `design-system-resolver.ts`, `queries.ts` (DS selection), `src/sanity/actions/*DesignSystem*` | Cheap→Mid | 5-step field parity; child-over-parent merge correctness |
| **Sanity & Content Contracts** | Schema, Studio structure, custom inputs, GROQ, generated types | `src/lib/sanity/schema.ts`, `queries.ts`, `types.ts`, `sanity.config.ts`, `src/lib/sanity/fields/*` | Mid | projectSlug scoping on every query; schema↔type↔GROQ parity; routable-type checklist; template-ID rule |
| **Supabase & Security** | DB schema, migrations, RLS, auth, API-route protection | `supabase/**`, `src/lib/supabase/*`, `src/app/api/**`, `src/proxy.ts` (auth) | Mid | RLS coverage; **no unauthenticated mutating route**; no service-role exposure; secret hygiene |
| **Localization** | Platform + tenant locales, dictionaries, routing, string audit | `src/i18n/*`, `src/lib/i18n/*`, `messages/*`, `LocalizedInput.tsx` | Cheap | Registry↔message-file completeness; no hardcoded user-facing strings; content vs interface separation |
| **Accessibility** | The a11y contract across components, DS, editor | cross-cutting (reviews others' diffs) | Mid | Component a11y contract (§7); `lang`; reduced motion; alt requirements; contrast tokens |
| **Testing & Review** | Test suites, coverage, flaky-test triage, code review | `**/__tests__/**`, `vitest.config.ts`, CI config | Cheap→Mid | Gates 1–3 green; new invariant ⇒ new test; no flaky tolerance |
| **Release Engineering** | Versioning, tags, `release.sh`/`doctor.sh`, deploy pipeline, post-deploy check | `scripts/*`, `next.config.ts`, `release.json`, deploy flow | Mid | Version-integrity gate; STOP-gate discipline; rollback readiness |
| **Documentation** | Authoritative docs, ADR lifecycle, supersession, handbook | `docs/**`, `CLAUDE.md`, `Abluo/**` | Cheap | One source of truth per concern; doc freshness; ADR numbering |
| **Architecture Review** | On-demand deep review of cross-cutting/ambiguous changes; pre-ADR critique | reads everything; writes nothing but findings | Strong | Principle alignment; catches the "section that stores data" / hardcoded-tenant class of mistake |

**Why not fewer:** collapsing Supabase and Security would blur the single most important invariant (API auth). Collapsing Accessibility into Frontend would let a11y be skipped under delivery pressure — Phase 2A shows it already was. Each agent exists because it guards an invariant that Phase 2A found violated or unenforced.

**Why not more:** Media, Forms, SEO, Analytics do not need standing agents — they are handled by Frontend/Sanity/Supabase within existing scope. Create a new specialist only when a domain has (a) its own invariants and (b) recurring work — see §3.6.

### 3.4 Boundaries, information flow, collaboration

```
                         ┌─────────────────────────┐
             Tom ◄──────►│      ORCHESTRATOR        │◄────► Architecture Review
        (decisions,      │ plan · route · synthesize│       (on-demand, strong)
         STOP gates)     │ hold cross-cutting rules │
                         └─────────┬────────────────┘
        task + context pack        │       ▲ findings/results
        ┌──────────┬──────────┬────┴─────┬──────────┬───────────┐
        ▼          ▼          ▼          ▼          ▼           ▼
   Frontend/   Design     Sanity &   Supabase & Localiza-   Release
   Sections    System     Contracts  Security   tion        Engineering
        │          │          │          │          │           │
        └──────────┴────►  Accessibility  &  Testing/Review  ◄──┘
                        (cross-cutting reviewers on every relevant diff)
```

- **Information flow:** Orchestrator → specialist gets *only* `{task, domain context pack, relevant file list}`. Specialist → Orchestrator returns `{diff/plan, self-check against its invariants, open questions}`. Cross-cutting reviewers (Accessibility, Testing, Security) receive the diff, not the whole repo.
- **Context ownership:** each specialist owns its **domain context pack** (the slice of the engineering handbook + the invariant list for its files). The Orchestrator owns the **spine** (principles, workflows, gate definitions). No agent re-reads `CLAUDE.md` wholesale — packs are pre-scoped, which is the main token-cost lever.
- **Collaboration pattern:** most workflows are a *chain with reviewers*, not a committee. Example — "new section" = Sanity (schema+query+type) → Frontend (component+renderer) → Testing (wiring test) → Accessibility (contract) → Documentation (note). The Orchestrator sequences and synthesizes.
- **When agents collaborate directly:** they don't — all coordination goes through the Orchestrator to keep context flow legible and prevent drift. Two specialists never edit the same file in parallel.

### 3.5 The shared context spine (reusable context)
A small, versioned set the Orchestrator injects and specialists inherit slices of:
- **Principles & invariants** (from §1 + the seven gates) — the spine.
- **Domain packs** — one per specialist: its files, its invariants, its checklist. This *replaces* re-reading `CLAUDE.md`.
- **The workflows (§4)** — each is a runbook a cheap model can execute.

This is the single biggest token-efficiency decision: cheap agents never load the 30 KB `CLAUDE.md`; they load a ~2–4 KB pack.

### 3.6 When to create / when humans decide
- **Create a specialist** when a domain gains its own invariants *and* recurring work (e.g. if a Payments/Billing capability arrives — currently correctly out of scope).
- **Create a throwaway sub-agent** for a bounded evidence sweep (like the Phase 2A verification) — spawned by the Orchestrator, not standing.
- **Humans (Tom) decide:** ADR acceptance; security tradeoffs (e.g. gate `/studio` vs accept risk); tenant go-live; production promotion (STOP gates); version/release cut; any irreversible action (delete, migrate published content, move money — the last is out of scope entirely).

---

## 4. Engineering Workflows

Each is a runbook: steps, responsible agent, review, gates. These turn today's manual checklists into repeatable, gate-backed sequences.

### 4.1 Create a new Section
| Step | Agent | Gate/Review |
|---|---|---|
| Define schema type; add to `page` (and, until retired, `homePage`); export in types array | Sanity | Schema compiles |
| Add interface to `types.ts` + `PageSection` union; project fields in the three page queries | Sanity | Contract-parity **[AUTO]** |
| Build component; register in the **single shared** SectionRenderer (post-I5, one place not two) | Frontend | Renderer parity **[AUTO]** |
| Studio `preview.prepare` returns meaningful title | Sanity | Editor-preview check |
| Wiring + render test | Testing | Test gate |
| a11y contract (headings, alt, motion) | Accessibility | A11y gate |
| One-line note if it changes editor capability | Documentation | Doc freshness |

### 4.2 Create a new Module
| Step | Agent | Gate |
|---|---|---|
| Add `ModuleManifest` to `MODULE_REGISTRY` (declarative only) | Sanity | `validateRegistry` green |
| Module schema in `lib/modules/<id>/schema.ts` | Sanity | Type gate |
| Section(s) that present module data (never store it) | Frontend | Section/Module orthogonality review **[AGENT]** |
| Permissions in `lib/modules/permissions.ts` | Supabase & Security | Permission test |
| Registry + navigation tests | Testing | Test gate |
| ADR if it introduces a new architectural pattern | Architecture Review → Tom | ADR accepted |

### 4.3 Add a Design System field
| Step | Agent | Gate |
|---|---|---|
| Field in `designSystem` schema | Design System | Type gate |
| Add to `DS_FIELDS_SELECTION` | Design System | **Parity test [AUTO]** |
| Merge logic in `mergeDesignSystems()` | Design System | Inheritance test (child-over-parent + inherit-when-unset) |
| CSS var in `buildCssVars()` (post-I5: extracted from route file) | Design System | Build gate |
| Inheritance test added | Testing | Test gate |
> The parity test makes skipping any step a *red build*, not a silent parent-fallback bug (the MetricsSection incident class).

### 4.4 Onboard a tenant (target: zero code)
| Step | Agent | Gate |
|---|---|---|
| Create `client`+`project`+`siteConfig`+`designSystem(active)` in Sanity; set `projectSlug`, domain, locales | Sanity | siteConfig exists for project **[AUTO check]** |
| Tenant resolution reads from data (post-I3: no `proxy.ts`/`client.ts`/`sitemap.ts` map edits) | Supabase & Security | No new hardcoded map entry **[AGENT]** |
| Supabase `tenants`/`projects` rows + membership | Supabase & Security | RLS/membership test |
| Domain in Vercel; verify preview | Release | Post-deploy smoke |
| — no component or layout edits — | — | **Reject if a `livener`-style branch is added** |

### 4.5 Add a language
| Step | Agent | Gate |
|---|---|---|
| Add to `PLATFORM_LOCALES` | Localization | Registry↔routing consistent |
| Add `messages/<code>.json` | Localization | **Completeness gate [AUTO]**: every routing locale has a file OR a safe fallback exists |
| Enable per-tenant via `siteConfig.supportedLocales` | Sanity | Content-locale resolves |

### 4.6 Implement a feature
Plan (ADR if architectural) → Orchestrator routes to owning specialist(s) → implement against contracts → cross-cutting review (a11y/security as applicable) → Verify gates → Release workflow.

### 4.7 Fix a bug
Reproduce (add a failing test first — Testing) → fix in owning domain → Verify gates green including the new test → normal release. **Invariant: a bug that a gate should have caught becomes a new gate.**

### 4.8 Prepare a release
Release agent runs `doctor.sh` + deterministic build + full test suite → version-integrity gate → cut single-format tag, sync `release.json`/`package.json` → dev push → **STOP (Tom verifies dev)** → preview → **STOP (Tom verifies preview)** → main + tag → post-deploy truth-check (`/api/version` == tag).

---

## 5. Architecture Improvements (initiatives)

Phase 2A findings grouped into strategic initiatives. Complexity: S/M/L. Each states objective, rationale, benefit, dependencies.

### I1 — Security Hardening `Critical` · Complexity M
**Objective:** No unauthenticated path can mutate content or reach a service-role client; no secret leaks.
**Rationale:** Verified Critical — `media` POST and `media/[id]` PATCH/DELETE mutate via write token with no auth; DELETE removes *any* document by id; `verify-token` leaks a token prefix; several `sanity/*` routes reach the RLS-bypassing admin client unauthenticated (public dataset ACL makes reads low-risk but writes are not).
**Benefit:** Closes the platform's one true P0. **Dependencies:** middleware/auth on `/api` (currently excluded by matcher). Includes: gate 6 in CI; GROQ-injection fix in media routes; decision on gating `/studio`.

### I2 — Release & Version Integrity (Release Automation v3) `Critical→Short` · S
**Objective:** One version concept, always true end-to-end.
**Rationale:** HEAD `V1.0.13` vs pipeline `v1.0.2`; V1.0.6–12 untagged; `CLAUDE.md` prescribes `V`, tooling prescribes `v`. Releases currently misreport version.
**Benefit:** Truthful deploys, real rollback targets, trustworthy gate. **Dependencies:** reconcile tag convention (pick one, update `CLAUDE.md` + `next.config.ts`), re-adopt `release.sh`, add post-deploy truth-check.

### I3 — Tenant Architecture Unification `Short→Medium` · M–L
**Objective:** Tenant behavior lives in data; the platform code names no tenant.
**Rationale:** `if (tenantId === 'livener')` ~55-line branch in the shared layout; tenant maps hardcoded in `proxy.ts`, `client.ts`, `sitemap.ts`; `components/livener/*` is de-facto platform chrome. Directly violates the platform's own "Platform Before Tenant" and "Configuration Over Hardcoding" rules.
**Benefit:** Unlocks the core success metric (onboard without deploy); removes the largest maintainability tax. **Dependencies:** config-driven tenant resolution source; fold Livener branch into the generic path behind `siteConfig` flags; rename chrome components to platform names.

### I4 — Accessibility by Default `Short→Medium` · M
**Objective:** New tenant sites are accessible without editor effort. (Full design in §7.)
**Rationale:** `<html lang="en">` hardcoded for all locales; core animation primitives ignore `prefers-reduced-motion`; no contrast validation on DS colour tokens; alt not required at schema level; no a11y lint/tests/docs.
**Benefit:** Platform-level a11y for every tenant at once; a genuine product differentiator. **Dependencies:** DS token model (contrast), animation primitives, schema validation, a11y lint in CI.

### I5 — Section & Rendering Framework Simplification `Medium` · M
**Objective:** One rendering path; a modular schema; no legacy double-wiring.
**Rationale:** SectionRenderer + hydration duplicated across two route files (already failed once — the shipped routing gap); `schema.ts` is a 135 KB monolith; legacy `homePage` doubles every section's wiring; dual `src/sanity/` + `src/lib/sanity/` with shims.
**Benefit:** Removes an entire incident class; halves section-wiring cost; smaller merge/context surface. **Dependencies:** extract shared renderer; split schema by domain (module pattern already proves it); retire `homePage`; collapse the dual Sanity dir.

### I6 — Content Contract Integrity `Medium` · M
**Objective:** Schema→GROQ→Types drift is impossible to merge.
**Rationale:** Types are hand-maintained (no codegen); the 5-step DS checklist and routable-type checklist are enforced only by human discipline.
**Benefit:** Gate 4 becomes real; the MetricsSection incident class is eliminated. **Dependencies:** Sanity typegen; parity-test generators.

### I7 — Localization Completeness `Short` · S
**Objective:** Every routing locale is safe; one clear dictionary model.
**Rationale:** 7 routing locales, 3 message files, no import fallback → `/fr /es /pt /nl` throw; two parallel dictionary mechanisms with an implicit boundary; a hardcoded CTA fallback on the public path.
**Benefit:** No 500s on enabled locales; clear i18n rules. **Dependencies:** fallback in `request.ts` or constrain routing locales; document/converge dictionaries.

### I8 — Documentation Consolidation `Short` · S
**Objective:** One authoritative document per concern; drift is detectable. (Full design in §8.)
**Rationale:** `CLAUDE.md` (top authority) has ≥3 stale facts; duplicated current-state docs across three locations; `ABLUO.md` contradicts ADR-001; ADR-012 referenced but missing; ADR casing/order inconsistencies.
**Benefit:** Reliable single source for every future session and agent. **Dependencies:** none blocking; pairs with I2 (tag convention) and I5.

### I9 — Testing & CI Foundation `Short` · M
**Objective:** A trustworthy, automated gate on every push.
**Rationale:** No CI (Phase 1); 2 flaky/timeout tests red at HEAD; zero route/API/integration/component tests; docs claim 46 tests vs actual 194.
**Benefit:** Gates 1–6 run automatically; regressions caught pre-merge. **Dependencies:** CI runner; fix flaky module-registry tests; add API-auth tests (pairs with I1).

### I10 — Engineering OS & Agent System `Ongoing` · M
**Objective:** Stand up the Orchestrator + specialists + context packs + workflows in this document.
**Rationale:** The meta-initiative that makes I1–I9 repeatable and cheap. **Dependencies:** the seven gates exist (esp. CI from I9) so agents have machine backstops.

**Dependency order:** I1 & I2 (now) → I9 (enables all gates) → I7, I8 (cheap, high-leverage) → I6, I3 → I4, I5 → I10 hardens throughout.

---

## 6. Engineering Backlog

Grouped, de-duplicated, mapped to initiatives.

### Critical (platform risk — do first)
- **I1** — Auth on all mutating `/api` routes; restrict `media/[id]` DELETE to `mediaAsset`; remove `verify-token` prefix leak; decide `/studio` gating. *(Verified Critical.)*
- **I2** — Reconcile version/tag split-brain; re-adopt release automation so deploys report truthfully.
- **I9 (subset)** — Make `vitest run` green (fix the 2 timeout tests) so the release gate is real.

### Short term (high-value, mostly small)
- **I9** — Add CI running gates 1–6 on push to `dev`.
- **I7** — Locale fallback + dictionary convergence + remove hardcoded CTA string.
- **I8** — Correct `CLAUDE.md` stale facts; mark `ABLUO.md`/duplicated audits superseded; write or unreference ADR-012.
- **I4 (quick wins)** — `lang` from active locale; `prefers-reduced-motion` in `SlideUp`/`FadeIn`/`Stagger`/`Parallax`; add jsx-a11y lint to CI.

### Medium term (architecture)
- **I3** — Config-driven tenant resolution; fold the Livener branch; rename chrome components.
- **I5** — Shared SectionRenderer; split `schema.ts`; retire `homePage`; collapse dual Sanity dir.
- **I6** — Sanity typegen; DS-field & routable-type parity tests.
- **I4 (deeper)** — Contrast validation on DS colour tokens; required/decorative alt at schema level; editor a11y guidance.

### Long term (strategic evolution)
- **I10** — Full agent operating system with context packs and workflow runbooks.
- Tenant self-onboarding flow (the 5-step success metric end-to-end).
- Module lifecycle completion (install/uninstall UX) per the ADR-011 roadmap.
- Performance: replace global CDN `no-store` with route-scoped caching once correctness is gate-protected.
- Editorial AI features (excerpt/FAQ/SEO/alt-text) — build *on top of* the now-enforced contracts, not before them.

---

## 7. Accessibility by Default

Make accessibility a *property of the platform*, so every tenant inherits it. Five layers, each turning an editor decision into a platform guarantee.

| Layer | Mechanism | Turns … into … |
|---|---|---|
| **Design System** | Contrast relationship validated between text/background tokens at DS resolve time; expose only accessible pairings | "a tenant can publish an unreadable palette" → "the DS refuses/warns" |
| **Components** | A **component a11y contract**: semantic element, label, focus-visible, keyboard, `aria-*` where needed; one place for reduced-motion (animation primitives) | per-component discipline → shared guarantee (`lang` correct; motion respected globally) |
| **Editor** | Required alt (or explicit "decorative"); heading-structure hints; the existing "describe for accessibility" nudge extended; future AI alt-text | "alt is skippable" → "alt is guided/required" |
| **Validation** | Schema-level requirements (alt), and DS-level contrast checks | silent gaps → Studio validation errors |
| **Testing/CI** | jsx-a11y lint gate; automated checks for `lang`, alt presence, reduced-motion usage; manual-check checklist for what tooling can't verify (contrast-in-context, SR order) | "no a11y checks anywhere" → gate 5 |
| **Documentation** | An a11y section in the engineering handbook + editor guidance | tribal knowledge → written contract |

**Explicitly separated** (per Phase 2A discipline): *automatable* (lang, alt presence, jsx-a11y, reduced-motion wiring, token contrast math) vs *manual* (contrast-in-context per tenant palette, keyboard traversal, screen-reader order, live-region behavior). We never claim WCAG compliance; we claim *default posture + enforced floor + honest manual checklist.*

**Ownership:** Accessibility agent authors the contract and reviews every UI diff; Design System agent enforces token contrast; Frontend implements; Testing wires the gate.

---

## 8. Documentation Strategy

**Principle:** exactly one authoritative document per concern; everything else is explicitly historical.

### Authoritative set (the only "current state" sources)
| Concern | Authoritative doc | Everything else |
|---|---|---|
| Engineering principles, invariants, workflows | **Engineering Handbook** (new; absorbs the durable parts of `CLAUDE.md`) | `ABLUO.md`, session notes → marked historical |
| Architecture decisions | `docs/architecture-decisions.md` (ADR log) | ADR-011 satellites remain as linked detail |
| Config/DS field register | `docs/config-architecture.md` | `abluo-configuration-audit.md` → historical |
| Release procedure & tooling | `docs/release-workflow.md` + `release-automation.md` | `Abluo/DEPLOYMENT.md` → historical |
| This engineering OS | this document | — |

### Lifecycles
- **ADR lifecycle:** Proposed → Review (Architecture Review agent critique) → **Accepted** (Tom) → optionally Superseded (never edited-in-place; a new ADR supersedes). Fix numbering/casing; write or unreference ADR-012.
- **Audit lifecycle:** an audit (like Phase 2A) is a dated snapshot → its findings become Backlog initiatives → the audit is marked "superseded by backlog" once absorbed. Audits never masquerade as current-state docs.
- **Implementation summaries:** replaced by the per-release build log + the ADR that motivated the work. No more standalone `*_IMPLEMENTATION_SUMMARY.md` proliferation in repo root.
- **Backlog management:** the Engineering Backlog (§6) is the single living work list; initiatives, not scattered TODOs.
- **Freshness:** the Documentation agent runs a periodic drift check (docs claim vs code reality — e.g. test counts, routable-type status) and flags staleness. Doc drift is a tracked defect.
- **Anti-duplication rule:** before writing a "current state" doc, an agent must confirm no authoritative doc already owns the concern; if one does, it updates that doc.

---

## 9. Success Metrics

Measurable, tied to the failures Phase 2A found.

| Metric | Today (evidence) | Target | How measured |
|---|---|---|---|
| **Tenant onboarding cost** | multi-file code change (I3) | **0 code files** touched | diff on onboarding = data only |
| **Release truthfulness** | HEAD tag ≠ reported version | 100% match | post-deploy `/api/version` == tag |
| **Automated gate coverage** | no CI; gates run ad-hoc | gates 1–6 on every `dev` push | CI present & required |
| **Test suite health** | 194 tests, 2 red, no route/API tests | 0 flaky; API-auth covered | `vitest run` green in CI |
| **Contract drift** | manual 5-step; no codegen | 0 mergeable drift | typegen + parity tests green |
| **Accessibility floor** | lang wrong, motion ignored, no checks | gate 5 green; a11y lint 0 errors | CI a11y gate |
| **Security posture** | unauth mutating routes (P0) | 0 unauthenticated mutating routes | security gate + review |
| **Doc freshness** | ≥3 stale facts in top doc | 0 known-stale in authoritative set | drift check |
| **Duplicated logic** | SectionRenderer ×2, dual sanity dir, 3 form dirs | single renderer; one sanity layer | structural review |
| **Token cost / task** | full `CLAUDE.md` per session | domain pack (~2–4 KB) per specialist | context-pack adoption |
| **Agent efficiency** | n/a | task done by cheapest capable agent; strong model reserved for architecture/synthesis | routing audit |

---

## 10. What we deliberately keep (do not rewrite)

The module registry (declarative, validated, tested) · DS inheritance + `DS_FIELDS_SELECTION` single projection · the ADR discipline and incident-post-mortem culture · the three-stage dev→preview→main flow with STOP gates · the content/interface localization separation · the "clients never see Sanity" product line. These are strengths; the operating system protects them, it does not replace them.

---

**Compliance:** No repository, Sanity, Supabase, or Vercel state was modified. This document is strategic design only; implementation of any initiative follows the workflow and gates defined above, pending Tom's approval and the normal ADR process for architectural items (I3, I5, I6, I10).

**Next step:** review and adopt. On approval, I2 and I8 (documentation + version convention) are the cheapest first moves; I1 is the highest-urgency; I9 (CI) is the multiplier that makes every other gate real.
