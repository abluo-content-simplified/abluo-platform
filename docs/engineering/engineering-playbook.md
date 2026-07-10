# Abluo Engineering Playbook
**Version:** 1.0
**Status:** Adopted — 2026-07-10 (Engineering Governance Release v1.0)
**Date:** 2026-07-10
**Supersedes:** Abluo Engineering System — Phase 2B (`phase-2b-engineering-system.md`; retained as origin)
**Derived from:** [Phase 1 Discovery](./phase-1-discovery.md) · [Phase 2A Technical Audit](./phase-2a-technical-audit.md) · [Phase 2A API Verification](./phase-2a-api-verification.md)
**Evolution:** This document evolves by version number (1.1, 1.2, 2.0…), not by new Phase documents.
**Nature:** Documentation only. No code or previous audit report was modified to produce this.

> **Playbook vs Operating System.** This document is the **Playbook** — the single source of truth for how Abluo is engineered. The **Engineering Operating System** is the running system it describes: the orchestrator, specialist agents, context packs, workflows, and quality gates. The Playbook defines them; Phase 3 implements them (§12, Next Phase).

---

## Authority

This Engineering Playbook is the **highest-level engineering document for Abluo**. It defines: engineering philosophy · engineering principles · evidence-based decision making · engineering workflows · quality gates · context-pack architecture · AI engineering strategy · the orchestrator and specialist-agent operating model · engineering governance.

Every other engineering document must be consistent with this Playbook. Supporting documents include **`CLAUDE.md`** (implementation handbook), **ADRs**, **domain documentation**, **engineering audits**, and **implementation notes**.

**Precedence.** If documentation conflicts, this Playbook takes precedence — unless an accepted ADR explicitly supersedes a specific provision. When the Playbook and an implementation must diverge, the Playbook is corrected first (via ADR), then the implementation follows (§12).

**Document layers.** The Playbook keeps four layers distinct and never presents one as another (Evidence First, P0):
- **Evidence-backed findings** — traceable to Phases 1–2A (repository, tests, or verified live state).
- **Architectural decisions** — the initiatives (§6) and the ADRs they enter through.
- **Governance** — principles, gates, decision ownership, agent maturity.
- **Future implementation** — Phase 3 work (§12, Next Phase), not yet built.

Assumptions and hypotheses are labelled as such and are never stated as facts.

### The role of `CLAUDE.md`

`CLAUDE.md` is **no longer the primary engineering document** — this Playbook is. `CLAUDE.md` becomes the **implementation handbook**: it operationalizes the principles defined here and may carry implementation details, checklists, coding conventions, and project-specific guidance. It is authoritative for *how* things are done in the codebase, within the boundaries this Playbook sets for *why* and *what*. **If `CLAUDE.md` conflicts with the Playbook, the Playbook wins** — and `CLAUDE.md` is corrected to match (the three stale facts identified in I8 are the first such correction).

---

## 0. Purpose

Abluo is a solo-owned, AI-operated, multi-tenant platform. Most engineering work is performed by AI models in cold-started sessions. The defining objective of this Playbook:

> **Abluo must behave consistently regardless of which AI model, chat session, or engineer performs the work.**

Every serious defect found in Phase 2A is the same failure — knowledge that lived in temporary model memory or a human checklist instead of in the system: the version split-brain, the `if (tenantId === 'livener')` branch, the manual 5-step Design System checklist, the routing gap that shipped, the stale facts in `CLAUDE.md`. None were capability failures. All were **continuity failures**.

The remedy is to make engineering knowledge persistent and model-independent by housing it inside:

- **architecture** (typed contracts, enforced boundaries)
- **workflows** (runbooks a cold session can execute — §5)
- **context packs** (per-domain, versioned, generated — §4)
- **quality gates** (machine-enforced invariants — §2)
- **ADRs** (decisions, with lifecycle — §9)
- **versioned documentation** (one authoritative source per concern — §9)

**Persistent engineering intelligence is the objective. Token efficiency is a consequence** — a well-scoped context pack is cheap *because* it is correct and minimal, not the other way around.

---

## 1. Engineering Vision

### Guiding principles

**P0 — Evidence First.** Evidence before opinion; evidence before recommendation; evidence before implementation. Every architectural recommendation must rest on repository evidence, documentation evidence, test evidence, or verified live-state evidence. Agents and humans must clearly label each claim as one of:
- **Verified fact** (checked against code, a passing test, or live state)
- **Assumption** (reasonable, unverified — stated as such)
- **Hypothesis** (a proposition to be tested)

Evidence takes precedence over prose. A confident narrative with no evidence is worth less than a terse finding with a file reference. This principle is why Phases 1–2A exist and why this Playbook is dense with references rather than argument.

**P1 — Invariants are enforced, not remembered.** If a rule matters (tenant scoping, DS field parity, alt text, version format), a test/type/lint/CI gate enforces it. Documentation describes; it never guards.

**P2 — The platform has no tenants in its code.** Tenant-specific behavior lives in data (Sanity `siteConfig`/`project`), never in `if (tenant === …)`. The 11th tenant must cost zero code.

**P3 — Contracts over conventions.** Schema → GROQ → Types is a typed pipeline, not a discipline. Drift is a build failure, not an incident.

**P4 — Small, sharp, persistent context.** Each unit of work carries the minimum context needed and the maximum context reuse, drawn from durable packs — never from a model's memory of a past session.

**P5 — Accessible and secure by default.** The easy path produces an accessible, secure result. Getting it wrong requires effort and trips a gate.

**P6 — Every commit is deployable.** (ADR-007, kept.) Phased work leaves the platform green at each step.

**P7 — Evolution over rewrite.** Preserve what works: the module registry, DS inheritance, the ADR discipline, the three-stage release flow.

### Engineering values
- **Truthful state.** Deployed version, test status, and docs always tell the truth. A green badge means green.
- **Reversibility.** Every change has a known rollback. Backups are rehearsed, not hoped for.
- **Editor calm.** Complexity is absorbed by the platform, never exported to the client. (Core product promise — non-negotiable.)
- **Legible history.** One authoritative doc per concern; superseded material is marked, not duplicated.

### What Abluo optimizes for
Consistency across sessions and models · long-term maintainability by a very small team + AI · onboarding a new tenant with near-zero code · release confidence · consistent design and accessibility across all tenants.

### What Abluo intentionally avoids
Enterprise process for its own sake · premature multi-repo/microservices · bespoke per-tenant code paths · CMS complexity leaking to clients · agent sprawl without owned invariants · hand-maintained parallel sources of truth (the root-cause pattern of Phase 2A).

---

## 2. Engineering Operating System — lifecycle & gates

Gates marked **[AUTO]** are machine-enforced (CI/local script); **[AGENT]** performed by a specialist; **[HUMAN]** require Tom.

```
 PLAN ──► IMPLEMENT ──► REVIEW ──► VERIFY ──► RELEASE ──► DEPLOY ──► POST-DEPLOY
  │           │            │          │           │          │            │
 ADR?      typed       domain +    tsc+test+   version    dev→prev→    live
 scope     contracts   a11y +      a11y+build  integrity  main w/      smoke +
 (HUMAN)   (AGENT)     security    (AUTO)      (AUTO)     STOP gates   truth-check
                       (AGENT)                            (HUMAN)      (AUTO+AGENT)
```

| Stage | What happens | Mandatory gates | Owner |
|---|---|---|---|
| **Plan** | Frame the change; decide ADR (architecture-affecting) or bounded implementation | ADR created & **Accepted** before architectural change **[HUMAN]**; else one-line intent | Orchestrator + Tom |
| **Implement** | Build against typed contracts; follow the relevant workflow (§5) | Touches only declared scope; new user-facing strings localized; no `if (tenant===…)` **[AGENT]** | Specialist |
| **Review** | Domain + cross-cutting review | Domain sign-off; **Accessibility gate** for UI; **Security gate** for any API/DB/auth change **[AGENT]** | Specialist + Accessibility/Security |
| **Verify** | Automated correctness | `tsc --noEmit` · `vitest run` green · `next build` clean · a11y lint · contract-parity tests **[AUTO]** | CI / `doctor.sh` |
| **Release** | Cut a version | **Version-integrity gate**: single format, tag created, `release.json`+`package.json` synced, tests green at HEAD **[AUTO]** | Release agent + Tom |
| **Deploy** | dev → preview → main | Literal **STOP** at dev and preview; explicit human approval each hop | Tom |
| **Post-deploy** | Confirm reality matches intent | Live `/api/version` == tag · smoke of critical routes · no new runtime errors **[AUTO+AGENT]** | Release agent |

### The mandatory seven gates
1. **Type** — `tsc --noEmit` clean.
2. **Test** — `vitest run` fully green (no flaky-timeout tolerance).
3. **Build** — deterministic `rm -rf .next && next build` clean.
4. **Contract-parity** — every DS field in schema *and* `DS_FIELDS_SELECTION` *and* merge *and* CSS var *and* a test; every routable type satisfies the 5-requirement checklist. Enforced by generated tests, not by reading `CLAUDE.md`.
5. **Accessibility** — jsx-a11y clean; `lang` correct; reduced-motion respected; component a11y contract met (§8).
6. **Security** — no mutating API route without an auth check; no service-role client reachable unauthenticated; no secret material in responses.
7. **Version-integrity** — one tag format; HEAD tag == pipeline version == `package.json`.

### Automation opportunities (highest leverage first)
- **CI on push to `dev`** running gates 1–6 (none exists today — Phase 1). Would have caught the shipped routing gap, the 2 flaky tests, and version drift.
- **Sanity typegen** to make gate 4 real.
- **Parity-test generators** for DS fields and routable types (turn the two `CLAUDE.md` checklists into tests).
- **Post-deploy truth-check** comparing `/api/version` to the released tag.

---

## 3. AI Engineering Strategy

### 3.1 Model of operation
One **Orchestrator** (strong model) plans, routes, holds cross-cutting invariants, synthesizes, and escalates. **Specialist agents** (mostly cheaper models) do bounded work inside one domain, carrying only their context pack. **Architecture Review** and final acceptance use a strong model and/or Tom.

Objective (per brief): not fewest agents — clearest ownership, most reusable context, most consistent quality, lowest cost as a consequence.

### 3.2 The orchestrator

| Responsibility | Detail |
|---|---|
| Planning & routing | Decompose a request into domain tasks; pick specialist(s); decide ADR-needed; **classify each decision's ownership level (§3.8) before routing.** |
| Cross-cutting invariants | Owns rules that span domains: "no tenant hardcoding", "every commit deployable", "user-facing strings localized", the deploy STOP gates. |
| Context ownership | Owns the **shared context spine** (§4); hands each specialist only its pack + task. |
| Synthesis | Merges specialist outputs into one coherent change and one narrative for Tom. |
| Escalation | Routes genuine decisions to Tom per §3.8. Never decides `Tom decides`-level items silently. |
| Quality backstop | Ensures the seven gates ran; refuses to advance a stage on a red gate. |

### 3.3 Specialist agents — how they come to exist
Specialists are **not a fixed roster**. A specialist is created where three conditions coincide:
1. a **stable architectural boundary** (from Phase 1 §9),
2. **recurring work** at that boundary, and
3. a set of **clearly owned invariants** it can guard.

The number will evolve as the platform does. The **current candidate set** (drawn on the boundaries where Phase 2A found invariants violated or unenforced):

| Candidate agent | Owns (scope) | Primary files | Model tier | Guards |
|---|---|---|---|---|
| **Frontend/Sections** | Section & website components, rendering, animation | `components/sections/*`, `components/animation/*`, `(website)/**` | Cheap | Section wiring; single shared SectionRenderer; animation via DS tokens only |
| **Design System** | Tokens, inheritance, merge, CSS-var emission, motion | `design-system-resolver.ts`, DS selection in `queries.ts`, DS actions | Cheap→Mid | 5-step field parity; child-over-parent merge |
| **Sanity & Content Contracts** | Schema, Studio, custom inputs, GROQ, generated types | `schema.ts`, `queries.ts`, `types.ts`, `sanity.config.ts`, `fields/*` | Mid | projectSlug scoping; schema↔type↔GROQ parity; routable-type checklist; template-ID rule |
| **Supabase & Security** | DB schema, migrations, RLS, auth, API-route protection | `supabase/**`, `lib/supabase/*`, `app/api/**`, `proxy.ts` (auth) | Mid | RLS coverage; **no unauthenticated mutating route**; no service-role exposure; secret hygiene |
| **Localization** | Platform + tenant locales, dictionaries, routing, string audit | `i18n/*`, `lib/i18n/*`, `messages/*`, `LocalizedInput.tsx` | Cheap | Registry↔message-file completeness; no hardcoded user-facing strings; content vs interface separation |
| **Accessibility** | The a11y contract across components, DS, editor | reviews others' diffs | Mid | Component a11y contract (§8); `lang`; reduced motion; alt; contrast tokens |
| **Testing & Review** | Test suites, coverage, flaky triage, code review | `**/__tests__/**`, `vitest.config.ts`, CI | Cheap→Mid | Gates 1–3 green; new invariant ⇒ new test |
| **Release Engineering** | Versioning, tags, `release.sh`/`doctor.sh`, deploy, post-deploy check | `scripts/*`, `next.config.ts`, `release.json` | Mid | Version-integrity gate; STOP discipline; rollback readiness |
| **Documentation** | Authoritative docs, ADR lifecycle, supersession, handbook | `docs/**`, this Playbook, `Abluo/**` | Cheap | One source of truth per concern; freshness; ADR numbering |
| **Architecture Review** | On-demand deep review of cross-cutting/ambiguous changes; pre-ADR critique | reads all; writes findings only | Strong | Principle alignment; catches hardcoded-tenant / "section that stores data" class |

**Rationale for the boundaries (not for a count):** Supabase and Security stay fused because the platform's single P0 (API auth) lives there. Accessibility is standing and cross-cutting because Phase 2A shows it gets skipped when folded into delivery. Media, Forms, SEO, Analytics get **no standing agent** — they lack their own recurring invariants and are handled within Frontend/Sanity/Supabase scope. Create a new specialist only when the three conditions above are met; otherwise extend an existing one.

### 3.4 Agent maturity
Every agent carries a maturity level. **New agents begin Experimental.**

| Level | Meaning | Trust / handling |
|---|---|---|
| **Experimental** | Newly created around a hypothesized boundary | Supervised; outputs reviewed by Orchestrator/Tom; may be merged or retired quickly |
| **Stable** | Proven on repeated tasks; owns its invariants | Trusted within scope; still reviewed on cross-cutting work |
| **Core** | Indispensable; guards a critical invariant | High trust; **changes to its context pack are themselves gated** |

- **Promotion** (Experimental→Stable→Core): demonstrated correctness across repeated tasks, clearly owned invariants, low escalation-error rate, and — for Core — guarding an invariant whose failure is a platform risk. **Promotion to Core is a `Tom approves` decision (§3.8).**
- **Merging:** two agents that share most context or are always invoked together should merge (their boundary was not real).
- **Retirement:** when a boundary dissolves or its work stops recurring, merge into an adjacent agent or retire. An Experimental agent that hasn't earned promotion is retired without ceremony.

### 3.5 Universal agent behaviour
Every specialist follows the same lifecycle (philosophy, not a prompt template):

1. **Load minimal context** — the task, the shared context spine, and its own context pack. Nothing else.
2. **Understand scope** — restate what is and isn't in bounds.
3. **Identify owned invariants** — the rules this agent must not let break.
4. **Gather evidence** — verify against code/tests/live state before asserting (P0). Label facts vs assumptions vs hypotheses.
5. **Refuse out-of-boundary work** — hand it back to the Orchestrator rather than reaching into another domain's files.
6. **Escalate architectural uncertainty** — do not resolve a `Tom decides`/`Tom approves` question locally.
7. **Run required gates** — the gates relevant to its change.
8. **Return a structured result** — findings, evidence, risks, and open decisions — not just a diff.

### 3.6 Boundaries, information flow, collaboration

```
                         ┌─────────────────────────┐
             Tom ◄──────►│      ORCHESTRATOR        │◄────► Architecture Review
        (decisions,      │ plan · route · classify  │       (on-demand, strong)
         STOP gates)     │ decisions · synthesize   │
                         └─────────┬────────────────┘
        task + context pack        │       ▲ findings/results
        ┌──────────┬──────────┬────┴─────┬──────────┬───────────┐
        ▼          ▼          ▼          ▼          ▼           ▼
   Frontend/   Design     Sanity &   Supabase & Localiza-   Release
   Sections    System     Contracts  Security   tion        Engineering
        │          │          │          │          │           │
        └──────────┴────►  Accessibility  &  Testing/Review  ◄──┘
                        (cross-cutting reviewers on relevant diffs)
```

- **Information flow:** Orchestrator → specialist gets `{task, context pack, relevant file list}`. Specialist → Orchestrator returns `{diff/plan, self-check vs invariants, evidence, open questions}`. Cross-cutting reviewers receive the diff, not the repo.
- **Collaboration is a chain with reviewers, not a committee.** Specialists never coordinate directly or edit the same file in parallel — all sequencing goes through the Orchestrator to keep context flow legible.

### 3.7 When to create a specialist / a throwaway agent
- **Standing specialist:** when the three conditions of §3.3 are met.
- **Throwaway sub-agent:** for a bounded evidence sweep (like the Phase 2A auth verification) — spawned by the Orchestrator, not standing.

### 3.8 Decision ownership
The Orchestrator classifies every decision into one of four levels **before routing work**:

| Level | Who acts | Examples |
|---|---|---|
| **AI decides** | Specialist proceeds | Bounded implementation within a domain; gate-passing changes; evidence gathering; writing tests; updating a doc it owns |
| **AI recommends** | AI presents options + evidence; Tom chooses | Architectural options; initiative sequencing; tradeoffs between valid designs |
| **Tom approves** | AI proposes; Tom signs off before it lands | ADR acceptance; release cut; stage promotion (STOP gates); promoting an agent to Core |
| **Tom decides** | Tom originates the call | Security tradeoffs (e.g. gate `/studio` vs accept risk); tenant go-live; production promotion; version convention; any irreversible action (delete/migrate published content) |

Anything an agent cannot confidently place at `AI decides` escalates upward. Ambiguity resolves toward Tom, never away.

---

## 4. Context Packs

Context packs are the mechanism that makes engineering knowledge persistent and model-independent (§0). They are the difference between an agent that *remembers* and a system that *knows*.

**Purpose.** Give an agent the **minimum context required for correctness** in its domain — no more, no less. A pack replaces "load the 30 KB `CLAUDE.md`" with "load your slice." Correctness is the goal; low token cost is the by-product.

**Ownership.** Each pack is owned by its specialist domain. The **shared spine** (principles P0–P7, the seven gates, the decision levels, the workflow index) is owned by the Orchestrator and inherited by every pack.

**Structure.** A pack contains only what its domain needs:
- files in scope (paths)
- owned invariants
- domain conventions
- the ADRs that govern the domain
- the workflows the domain executes
- the contracts it must honor
- the open backlog items touching the domain

**Nothing unrelated.** The Frontend agent never receives Supabase context. The Accessibility agent never receives Release context. Cross-domain leakage is a pack defect.

**Inheritance.** Every pack = shared spine (inherited) + domain-specific additions. Domain content is additive; a pack never contradicts the spine or an accepted ADR.

**Versioning.** Packs are versioned and reference the ADRs and platform version they reflect, so an agent knows whether its pack is current.

**Lifecycle.** Created with its agent; lives as long as the boundary; retired when the agent is merged or retired.

**Invalidation.** A pack is invalidated by any change to its authoritative sources — an accepted ADR, a schema change, a completed initiative, a new invariant. An invalidated pack must be regenerated before the agent is trusted again.

**Generation.** Packs are **derived from the authoritative documents and the code** (the handbook, the ADR log, `config-architecture.md`, schema/queries/types) — ideally generated, not hand-copied, so a pack cannot drift from its sources. Update the source first, then regenerate the pack (never edit a pack to disagree with an ADR).

**Update rules.** Source-of-truth changes → regenerate affected packs → bump pack version. A Core agent's pack change is itself gated (§3.4).

**Target size.** Small. Shared spine: compact. Domain pack: on the order of a few KB — enough to be correct, small enough to be cheap. If a pack approaches the size of `CLAUDE.md`, the boundary is wrong or the pack is carrying unrelated context.

**Example — Sanity Context Pack** contains: the schema types and structure; the GROQ queries and `DS_FIELDS_SELECTION`; the generated types; Sanity conventions (projectSlug scoping, template-ID rule); the governing ADRs (001, 004, 009–011); the workflows it runs (new section, new module, add DS field); its invariants (every tenant query filters projectSlug; schema↔type↔GROQ parity; routable-type checklist); and the backlog items touching Sanity (I5, I6). It contains **no** Supabase auth, no release tooling, no CSS-var emission internals beyond the contract it hands the Design System agent.

**Objective: minimize context while maximizing correctness.** That ordering is deliberate.

---

## 5. Engineering Workflows

Runbooks that turn today's manual checklists into gate-backed sequences. Each: steps, responsible agent, review/gate.

### 5.1 Create a new Section
| Step | Agent | Gate/Review |
|---|---|---|
| Define schema type; add to `page` (and, until retired, `homePage`); export in types array | Sanity | Schema compiles |
| Add interface to `types.ts` + `PageSection` union; project fields in the three page queries | Sanity | Contract-parity **[AUTO]** |
| Build component; register in the **single shared** SectionRenderer (post-I5, one place not two) | Frontend | Renderer parity **[AUTO]** |
| Studio `preview.prepare` returns meaningful title | Sanity | Editor-preview check |
| Wiring + render test | Testing | Test gate |
| a11y contract (headings, alt, motion) | Accessibility | A11y gate |
| One-line note if editor capability changes | Documentation | Doc freshness |

### 5.2 Create a new Module
| Step | Agent | Gate |
|---|---|---|
| Add `ModuleManifest` to `MODULE_REGISTRY` (declarative only) | Sanity | `validateRegistry` green |
| Module schema in `lib/modules/<id>/schema.ts` | Sanity | Type gate |
| Section(s) presenting module data (never storing it) | Frontend | Section/Module orthogonality review **[AGENT]** |
| Permissions in `lib/modules/permissions.ts` | Supabase & Security | Permission test |
| Registry + navigation tests | Testing | Test gate |
| ADR if it introduces a new pattern | Architecture Review → Tom | ADR accepted **[Tom approves]** |

### 5.3 Add a Design System field
| Step | Agent | Gate |
|---|---|---|
| Field in `designSystem` schema | Design System | Type gate |
| Add to `DS_FIELDS_SELECTION` | Design System | **Parity test [AUTO]** |
| Merge logic in `mergeDesignSystems()` | Design System | Inheritance test (override + inherit-when-unset) |
| CSS var in `buildCssVars()` (post-I5: extracted from route file) | Design System | Build gate |
| Inheritance test added | Testing | Test gate |
> The parity test makes skipping any step a red build, not a silent parent-fallback bug (the MetricsSection incident class).

### 5.4 Onboard a tenant (target: zero code)
| Step | Agent | Gate |
|---|---|---|
| Create `client`+`project`+`siteConfig`+`designSystem(active)` in Sanity; set `projectSlug`, domain, locales | Sanity | siteConfig exists for project **[AUTO]** |
| Tenant resolution reads from data (post-I3: no `proxy.ts`/`client.ts`/`sitemap.ts` edits) | Supabase & Security | No new hardcoded map entry **[AGENT]** |
| Supabase `tenants`/`projects` rows + membership | Supabase & Security | RLS/membership test |
| Domain in Vercel; verify preview | Release | Post-deploy smoke |
| — no component or layout edits — | — | **Reject if a `livener`-style branch is added** |

### 5.5 Add a language
| Step | Agent | Gate |
|---|---|---|
| Add to `PLATFORM_LOCALES` | Localization | Registry↔routing consistent |
| Add `messages/<code>.json` | Localization | **Completeness gate [AUTO]**: every routing locale has a file OR a safe fallback exists |
| Enable per-tenant via `siteConfig.supportedLocales` | Sanity | Content-locale resolves |

### 5.6 Implement a feature
Plan (ADR if architectural) → Orchestrator classifies decisions (§3.8) and routes → implement against contracts → cross-cutting review (a11y/security as applicable) → Verify gates → Release workflow.

### 5.7 Fix a bug
Reproduce with a **failing test first** (Testing) → fix in owning domain → Verify gates green including the new test → normal release. **Invariant: a bug a gate should have caught becomes a new gate.**

### 5.8 Prepare a release
Release agent: `doctor.sh` + deterministic build + full suite → version-integrity gate → cut single-format tag, sync `release.json`/`package.json` → dev push → **STOP (Tom verifies dev)** → preview → **STOP (Tom verifies preview)** → main + tag → post-deploy truth-check (`/api/version` == tag).

---

## 6. Architecture Improvements — initiatives

Phase 2A findings grouped into initiatives, now organized into **Platform Quality** (safety, correctness, operability of the platform as it stands) and **Platform Architecture** (structural evolution of the codebase). Initiatives are unchanged from Phase 2B; only their grouping is new. Complexity: S/M/L.

### 6.1 Platform Quality

**I1 — Security Hardening** `Critical` · M
Objective: no unauthenticated path can mutate content or reach a service-role client; no secret leaks. Rationale (verified): `media` POST and `media/[id]` PATCH/DELETE mutate via write token with no auth; DELETE removes *any* document by id; `verify-token` leaks a token prefix; several `sanity/*` routes reach the RLS-bypassing admin client unauthenticated (public dataset ACL keeps reads low-risk, writes not). Benefit: closes the one true P0. Dependencies: auth on `/api` (currently excluded by matcher); gate 6 in CI; GROQ-injection fix in media routes; decision on gating `/studio` (`Tom decides`).

**I2 — Release & Version Integrity (Release Automation v3)** `Critical→Short` · S
Objective: one version concept, always true end-to-end. Rationale: HEAD `V1.0.13` vs pipeline `v1.0.2`; V1.0.6–12 untagged; `CLAUDE.md` prescribes `V`, tooling prescribes `v`. Benefit: truthful deploys, real rollback targets, trustworthy gate. Dependencies: pick one tag convention (`Tom decides`), update `CLAUDE.md` + `next.config.ts`; re-adopt `release.sh`; add post-deploy truth-check.

**I4 — Accessibility by Default** `Short→Medium` · M
Objective: new tenant sites are accessible without editor effort (full design §8). Rationale: `<html lang="en">` hardcoded for all locales; core animation primitives ignore `prefers-reduced-motion`; no contrast validation on DS colour tokens; alt not required at schema level; no a11y lint/tests/docs. Benefit: platform-level a11y for every tenant at once. Dependencies: DS token model (contrast), animation primitives, schema validation, a11y lint in CI.

**I7 — Localization Completeness** `Short` · S
Objective: every routing locale is safe; one clear dictionary model. Rationale: 7 routing locales, 3 message files, no fallback → `/fr /es /pt /nl` throw; two parallel dictionary mechanisms; a hardcoded CTA fallback on the public path. Benefit: no 500s on enabled locales. Dependencies: fallback in `request.ts` or constrain routing locales; document/converge dictionaries.

**I8 — Documentation Consolidation** `Short` · S
Objective: one authoritative document per concern; drift detectable (full design §9). Rationale: `CLAUDE.md` has ≥3 stale facts; duplicated current-state docs across three locations; `ABLUO.md` contradicts ADR-001; ADR-012 referenced but missing; ADR casing/order inconsistencies. Benefit: reliable single source for every session and agent. Dependencies: none blocking; pairs with I2 and I5.

**I9 — Testing & CI Foundation** `Short` · M
Objective: a trustworthy automated gate on every push. Rationale: no CI (Phase 1); 2 flaky/timeout tests red at HEAD; zero route/API/integration/component tests; docs claim 46 tests vs actual 194. Benefit: gates 1–6 run automatically. Dependencies: CI runner; fix flaky module-registry tests; add API-auth tests (pairs with I1).

### 6.2 Platform Architecture

**I3 — Tenant Architecture Unification** `Short→Medium` · M–L
Objective: tenant behavior lives in data; platform code names no tenant. Rationale: `if (tenantId === 'livener')` ~55-line branch in the shared layout; tenant maps hardcoded in `proxy.ts`, `client.ts`, `sitemap.ts`; `components/livener/*` is de-facto platform chrome. Violates "Platform Before Tenant" and "Configuration Over Hardcoding". Benefit: unlocks onboard-without-deploy; removes the largest maintainability tax. Dependencies: config-driven tenant resolution; fold Livener branch behind `siteConfig` flags; rename chrome components. (ADR required.)

**I5 — Section & Rendering Framework Simplification** `Medium` · M
Objective: one rendering path; modular schema; no legacy double-wiring. Rationale: SectionRenderer + hydration duplicated across two route files (already failed once); `schema.ts` 135 KB monolith; legacy `homePage` doubles wiring; dual `src/sanity/` + `src/lib/sanity/` with shims. Benefit: removes an incident class; halves section-wiring cost. Dependencies: extract shared renderer; split schema by domain; retire `homePage`; collapse dual Sanity dir. (ADR required.)

**I6 — Content Contract Integrity** `Medium` · M
Objective: Schema→GROQ→Types drift is impossible to merge. Rationale: types hand-maintained (no codegen); 5-step DS + routable-type checklists enforced only by discipline. Benefit: gate 4 becomes real; eliminates the MetricsSection incident class. Dependencies: Sanity typegen; parity-test generators. (ADR advisable.)

### 6.3 Cross-cutting (spans both groups)

**I10 — Engineering OS & Agent System** `Ongoing` · M
Objective: stand up the Orchestrator + specialists + context packs + workflows defined in this Playbook. Rationale: the meta-initiative that makes I1–I9 repeatable and cheap. Dependencies: the seven gates exist (esp. CI from I9) so agents have machine backstops. This is the subject of Phase 3 (§12).

**Dependency order:** I1 & I2 (now) → I9 (enables all gates) → I7, I8 (cheap, high-leverage) → I6, I3 → I4, I5 → I10 hardens throughout.

---

## 7. Engineering Backlog

Grouped, de-duplicated, mapped to initiatives.

### Critical (platform risk — first)
- **I1** — Auth on all mutating `/api` routes; restrict `media/[id]` DELETE to `mediaAsset`; remove `verify-token` prefix leak; decide `/studio` gating.
- **I2** — Reconcile version/tag split-brain; re-adopt release automation so deploys report truthfully.
- **I9 (subset)** — Make `vitest run` green (fix the 2 timeout tests) so the release gate is real.

### Short term (high-value, mostly small)
- **I9** — CI running gates 1–6 on push to `dev`.
- **I7** — Locale fallback + dictionary convergence + remove hardcoded CTA string.
- **I8** — Correct `CLAUDE.md` stale facts; mark `ABLUO.md`/duplicated audits superseded; write or unreference ADR-012.
- **I4 (quick wins)** — `lang` from active locale; `prefers-reduced-motion` in `SlideUp`/`FadeIn`/`Stagger`/`Parallax`; jsx-a11y lint in CI.

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
- Editorial AI features (excerpt/FAQ/SEO/alt-text) — built on the now-enforced contracts, not before them.

---

## 8. Accessibility by Default

Make accessibility a property of the platform, so every tenant inherits it. Five layers, each turning an editor decision into a platform guarantee.

| Layer | Mechanism | Turns … into … |
|---|---|---|
| **Design System** | Contrast validated between text/background tokens at DS resolve time | "a tenant can publish an unreadable palette" → "the DS refuses/warns" |
| **Components** | Component a11y contract: semantic element, label, focus-visible, keyboard, `aria-*`; one place for reduced-motion (animation primitives) | per-component discipline → shared guarantee |
| **Editor** | Required alt (or explicit "decorative"); heading hints; the existing "describe for accessibility" nudge extended; future AI alt-text | "alt is skippable" → "alt is guided/required" |
| **Validation** | Schema-level requirements (alt) + DS-level contrast checks | silent gaps → Studio validation errors |
| **Testing/CI** | jsx-a11y gate; automated checks for `lang`, alt presence, reduced-motion; manual checklist for the rest | "no a11y checks anywhere" → gate 5 |
| **Documentation** | a11y section in the handbook + editor guidance | tribal knowledge → written contract |

**Automatable vs manual** (kept explicit): automatable = `lang`, alt presence, jsx-a11y, reduced-motion wiring, token-contrast math; manual = contrast-in-context per palette, keyboard traversal, screen-reader order, live-region behavior. We never claim WCAG compliance; we claim default posture + enforced floor + honest manual checklist. Ownership: Accessibility agent authors the contract and reviews every UI diff; Design System enforces token contrast; Frontend implements; Testing wires the gate.

---

## 9. Documentation Strategy

**Principle:** exactly one authoritative document per concern; everything else is explicitly historical.

### Authoritative set
| Concern | Authoritative doc | Everything else |
|---|---|---|
| Engineering principles, invariants, workflows, agents | **This Playbook** (absorbs the durable parts of `CLAUDE.md`) | `ABLUO.md`, session notes → historical |
| Architecture decisions | `docs/architecture/architecture-decisions.md` | ADR-011 satellites remain linked detail |
| Config/DS field register | `docs/config-architecture.md` | `abluo-configuration-audit.md` → historical |
| Release procedure & tooling | `docs/release-workflow.md` + `release-automation.md` | `Abluo/DEPLOYMENT.md` → historical |

### Lifecycles
- **ADR lifecycle:** Proposed → Review (Architecture Review critique) → **Accepted** (Tom) → optionally Superseded (never edited-in-place; a new ADR supersedes). Fix numbering/casing; write or unreference ADR-012.
- **Audit lifecycle:** an audit is a dated snapshot → its findings become Backlog initiatives → the audit is marked "superseded by backlog" once absorbed. Audits never masquerade as current-state docs.
- **Implementation summaries:** replaced by the per-release build log + the motivating ADR. No standalone `*_IMPLEMENTATION_SUMMARY.md` proliferation.
- **Backlog management:** §7 is the single living work list; initiatives, not scattered TODOs.
- **Freshness:** the Documentation agent runs a periodic drift check (docs claim vs code reality — e.g. test counts, routable-type status) and flags staleness as a tracked defect.
- **Anti-duplication rule:** before writing a "current state" doc, confirm no authoritative doc owns the concern; if one does, update it.
- **Context-pack link:** authoritative docs are the generation source for context packs (§4). Update the doc, regenerate the pack.

---

## 10. Success Metrics

| Metric | Today (evidence) | Target | Measured by |
|---|---|---|---|
| **Tenant onboarding cost** | multi-file code change (I3) | **0 code files** | onboarding diff = data only |
| **Release truthfulness** | HEAD tag ≠ reported version | 100% match | `/api/version` == tag post-deploy |
| **Automated gate coverage** | no CI | gates 1–6 on every `dev` push | CI present & required |
| **Test suite health** | 194 tests, 2 red, no route/API tests | 0 flaky; API-auth covered | `vitest run` green in CI |
| **Contract drift** | manual 5-step; no codegen | 0 mergeable drift | typegen + parity tests green |
| **Accessibility floor** | lang wrong, motion ignored, no checks | gate 5 green | CI a11y gate |
| **Security posture** | unauth mutating routes (P0) | 0 unauth mutating routes | security gate + review |
| **Doc freshness** | ≥3 stale facts in top doc | 0 known-stale in authoritative set | drift check |
| **Duplicated logic** | SectionRenderer ×2, dual sanity dir, 3 form dirs | single renderer; one sanity layer | structural review |
| **Consistency across sessions** | continuity failures (Phase 2A) | invariants enforced by gates, not memory | gate coverage of each invariant |
| **Context-pack scoping** | full `CLAUDE.md` per session | per-domain pack; no cross-domain leakage | pack audit |
| **Agent efficiency** | n/a | cheapest capable agent per task; strong model reserved for architecture/synthesis | routing audit |

---

## 11. What we deliberately keep (do not rewrite)

The module registry (declarative, validated, tested) · DS inheritance + `DS_FIELDS_SELECTION` single projection · the ADR discipline and incident-post-mortem culture · the three-stage dev→preview→main flow with STOP gates · the content/interface localization separation · the "clients never see Sanity" product line. The operating system protects these; it does not replace them.

---

## 12. From Playbook to Implementation

This Playbook is the **single source of truth** for the next stage. **Phase 3 implements it directly:**

- **Orchestrator** — built from §3.2 (responsibilities), §3.8 (decision classification), and the gate-backstop role in §2.
- **Context packs** — generated per §4 from the authoritative docs (§9) and code; one per candidate agent in §3.3.
- **Specialist agents** — instantiated per §3.3 around the stated boundaries, each starting **Experimental** (§3.4), following the universal behaviour of §3.5.
- **Workflows** — the runbooks of §5 become the agents' executable procedures.
- **Quality gates** — the seven gates of §2 become CI + local automation (I9 first, since it is the multiplier that makes every other gate real).

Sequencing into Phase 3: land I1 and I2 (Critical), stand up I9 (CI) so gates are enforceable, then instantiate the Orchestrator and the first Experimental specialists against real workflows — promoting to Stable/Core only on demonstrated value. Every architectural initiative (I3, I5, I6, I10) enters through the ADR process defined here.

The Playbook governs; Phase 3 executes. When they disagree, the Playbook is corrected first (via ADR), then the implementation follows — never the reverse.

---

## Next Phase

This Playbook is the foundation for **Phase 3**, which implements — deriving directly from this document — the:

- **Context Packs** (§4)
- **Orchestrator** (§3.2, §3.8)
- **Specialist Agents** (§3.3–3.5; each starts Experimental)
- **Engineering Workflows** (§5)
- **Automated Quality Gates** (§2; CI-first via I9)

Each implementation must trace to a section of this Playbook. Nothing in Phase 3 introduces engineering policy that is not first written here; new policy enters the Playbook (by version bump or ADR) before it is built.

---

**Compliance:** No repository, Sanity, Supabase, or Vercel state was modified. No previous audit report was modified. This is documentation only. Adoption and any initiative implementation follow the workflows, gates, and decision levels defined above, pending Tom's approval.
