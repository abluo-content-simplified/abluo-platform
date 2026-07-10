# ADR-011 — Architecture Review (Pre-Acceptance)

**Status:** Review (analysis only — input to ADR-011 before it is Accepted)
**Date:** 2026-06-26
**Reviews:** ADR-011 — Module Management Architecture (Proposed)

> This is a critical architecture review, not a rewrite. It identifies weaknesses
> in the ADR-011 draft, answers the seven review questions, recommends additional
> principles, and lists the specific changes to make before ADR-011 is accepted.
> No code, no schemas, no migrations.

---

## Verdict in one line

ADR-011 is structurally sound and its conclusions are right, but it is **described one layer too low** — it reasons in terms of today's technologies (TypeScript, Sanity, Supabase) and today's data shape (an array on the project document) instead of in terms of durable architectural concepts. The fixes are reframings, not reversals. Two genuine *gaps* also surfaced: there is no **Module Runtime** layer and no **registration architecture**. Both should be added before acceptance.

---

## Architectural weaknesses (summary, before the question-by-question analysis)

1. **Technology names leak into architectural statements** (Q1). The biggest issue. "Definitions live in TypeScript," "uses Sanity," "uses Supabase" bind the architecture to implementations. If any of the three is replaced, the ADR reads as wrong rather than as bound-to-a-changed-implementation.
2. **The registry is described as a code construct, not a concept** (Q7). There is no layered vocabulary, so the ADR cannot cleanly separate "what a module is" from "what runs."
3. **The Runtime layer is missing** (Q5, Q7). ADR-011 covers Definition, Manifest, Registry, and Installation, but never names the layer that *resolves manifest + installation + tenant context into what actually executes*. This is exactly where §7's "version = migration state" argument lives, and it is currently prose without a home.
4. **No registration architecture** (Q5). The manifest is defined, but *how a module's schemas, pages, collections, permissions, APIs, and frontend get wired in* is never specified. Without this, the §9 promise ("add a manifest, nothing else changes") is asserted, not designed.
5. **`ModuleInstallation` is positioned as a field on the project document** (Q2). This bloats the project document and treats Modules differently from the other project-configuration domains (Domains, Billing, Locales…) that will follow.
6. **Dependencies are single-class** (Q4). No distinction between a hard requirement and an optional integration — which understates how much the contract-not-storage principle buys.
7. **§7's reasoning is contingent on the single-runtime topology but stated as permanent** (Q1 nuance). "One shared codebase, one shared instance" is a real *current* constraint, not a law. It should be an explicit, named assumption so the conclusions remain traceable if topology changes.
8. **Ownership is stated as a machinery relationship, not a vertical-slice principle** (Q3). §6 is correct but does not crystallise the "a module owns its whole slice" idea that would most simplify future development.
9. **No taxonomy / category dimension** (Q6). Minor and non-urgent, but worth reserving.

---

## 1. Technology vs Architecture

**The critique is correct and is the single most valuable change to make.** ADR-011 repeatedly states implementation where it should state concept. The fix is to introduce abstractions and bind them to technology in exactly one place.

### Recommended abstractions

| Today's wording in ADR-011 | Architectural concept | Today's binding |
|---|---|---|
| "Module definitions live in TypeScript" | **Module Definition** (declared in code) | TypeScript modules |
| "the manifest is a typed object" | **Module Manifest** | TypeScript object literal |
| "`MODULE_REGISTRY` constant" | **Module Registry** | In-code registry |
| "Sanity" (content) | **Content Store** | Sanity |
| "Supabase" (operational) | **Operational Store** | Supabase |
| "GROQ query / dataset" | **Content Store query / dataset** | GROQ / Sanity dataset |
| "RLS / tables" | **Operational Store tenancy / tables** | Supabase RLS / Postgres |

### The mechanism: a single binding table

ADR-011 should open with a short **"Terminology & Technology Bindings"** section that (a) defines each abstract concept and (b) maps it to its current implementation in one table. The body then uses only the abstractions. This is the same discipline the platform already applies elsewhere — *configuration over hardcoding* — applied to the ADR's own prose. The payoff: if the Content Store is ever migrated off Sanity, only the binding table changes; every principle in the document still reads true.

### A necessary caveat — don't over-abstract a real constraint

One statement in ADR-011 is **not** a technology binding and must not be abstracted away: the **single shared runtime** ("one shared codebase, one shared instance," which drives the §7 conclusion that two tenants cannot run two code versions). That is a *deployment-topology fact*, not a tool choice. The correct treatment is the opposite of abstraction: name it explicitly as a **Deployment Topology Assumption**, and state that the §7 conclusions follow *from* it — so that if Abluo ever moves to isolated per-tenant runtimes, the reader knows exactly which conclusions to revisit. Abstract the technologies; surface the assumptions.

**Recommendation:** add the binding table; sweep the body to use Content Store / Operational Store / Module Definition / Manifest / Registry; convert the single-runtime claim into a named assumption.

---

## 2. Project Settings — Modules as a section, not a field on the project

**The alternative is better long-term, and it strengthens rather than contradicts the ADR's §4 phasing.** But it must be analysed at two layers that the question slightly blends: information architecture and data model.

### Information architecture

"Project Settings" is a distinct domain — the platform-admin configuration of a project — separate from the project's *identity*. Modules, Domains, Locales, Analytics, Deployment, Permissions, Integrations, and Billing are all facets of that one domain. Grouping them under a Project Settings area is the natural structure and it directly extends the Settings section ADR-010 already introduced. **Modules should be one bounded area inside Project Settings, not a special case.**

### Data model — the important refinement

"Becomes a section in Project Settings" is an IA statement; the deeper consequence is that **`ModuleInstallation` should be a first-class entity, not an array field on the project document.** ADR-011 currently says "upgrade `enabledModules` from `string[]` to an array of objects *on the project document*." That was the cheap Phase-A move, but as the end-state it is wrong for the same reason piling Domains, Billing, and Integrations onto the project document would be wrong: the project document becomes a junk drawer of unrelated configuration.

The cleaner model: each Project Settings area (Modules, Domains, Billing, …) is its own entity within the Project Settings domain. A **Module Installation** is its own record, related to the project, surfaced by the Modules area. This:

- keeps the project document about *identity*, not configuration;
- lets each settings area evolve and move stores independently (Billing → Operational Store, Locales → already Content Store, Modules → installation record) without reshaping the project document each time;
- makes the §4 Sanity→Operational-Store phasing *cleaner*, because an Installation entity can relocate without touching the project document at all.

### A guard against premature structure

Do not build all eight areas now — that violates *"the simplest version that proves the concept."* The recommendation is to **name Project Settings as the destination architecture** (a domain of independent configuration areas, of which Modules is the first) while building only Modules today. The other areas are acknowledged, not implemented.

**Recommendation:** reframe §4 and §8 so that (a) Project Settings is an admin configuration *domain* of independent areas; (b) Modules is one area; (c) `ModuleInstallation` is a first-class entity within that area, not a field on the project document; (d) only Modules is built now.

---

## 3. Module ownership as an explicit principle

**Yes — adopt it, with one sharpening so it does not collide with §6.** The proposed principle ("a module owns its capability, configuration, UI, permissions, documentation; the platform provides generic infrastructure") is the vertical-slice / inversion-of-control statement, and it is exactly what makes future module development cheap: a module is a self-contained slice, and adding one requires no edits scattered across the platform.

### The sharpening: ownership is three-way, not two-way

§6 already establishes that a module owns the *shape* while the project owns the *values*. The Q3 list says "module owns configuration," which read literally would contradict that. State the principle as a clean three-way split so both are true:

| Concern | Module owns | Project owns | Platform owns |
|---|---|---|---|
| Capability | the capability (code) | — | the runtime that hosts it |
| Configuration | the config **schema** | the config **values** | the UI that renders the schema |
| UI / frontend | its components & renderers | content shown in them | the renderer that mounts them |
| Permissions | the permission **definitions** | permission **assignments** (via membership) | enforcement |
| Documentation | its docs & changelog | — | where docs are surfaced |

The one-line principle: **a module is a vertical slice — it owns its capability, its configuration *schema*, its UI, its permission *definitions*, and its documentation; the project owns the values, content, and assignments; the platform owns the generic infrastructure.** This both adopts Q3 and stays consistent with §6, and it is only *achievable* if registration is declarative (Q5) — the two principles are a pair.

**Recommendation:** add the vertical-slice ownership principle, expressed as the three-way table.

---

## 4. Optional dependencies

**Yes — distinguish required dependencies from optional integrations. It is a clean, important distinction and it reinforces the contract principle.**

| | Required dependency | Optional integration |
|---|---|---|
| Meaning | B cannot function without A | B is enhanced by A, degrades gracefully without it |
| Example | (rare by design) | Booking → CRM; Team → Calendar |
| Checked | install-time, hard, version-ranged | runtime, soft, capability-detected |
| Effect on uninstall of A | blocks while B depends on A | none — B continues, degraded |
| Coupling | hard | optional, safe |

### Why it matters architecturally

An optional integration is, by definition, expressed through the other module's **contract** with **feature detection** — B asks "is a CRM contract available?" and lights up the integration if so. It must never reach into A's store. So optional integrations are a concrete argument *for* the §11 contract-not-storage principle, and they are what make a future ecosystem composable: optional coupling is safe coupling.

### A principle to add

Required dependencies create hard coupling and undermine independent installability (constraint #5). The architecture should therefore **prefer optional integration over required dependency**: a module should install and function standalone wherever practical, and reach for a required dependency only when the capability is genuinely impossible without it. In manifest terms this is two declarations — `requires` (hard, version-ranged) and `integratesWith` (soft, capability-detected) — not one `dependencies` list.

**Recommendation:** split dependencies into required vs optional; add the "prefer optional integration" principle.

---

## 5. Module installation — the registration architecture (the missing question)

**This is the most important gap. ADR-011 defines the manifest but never says how a module's capabilities get wired into the platform.** Without it, §9's central promise is an assertion. Three models exist; the cleanest is the middle path stated precisely.

### The three models

| Model | How a module wires in | Verdict |
|---|---|---|
| **Manual / scattered** (today) | Edit the structure builder, the renderer's case map, the schema array, the permission set, the route table — by hand, per module | Rejected. This is the "New Section Checklist" problem at module scale: error-prone, doesn't scale, violates vertical-slice ownership (Q3). |
| **Automatic discovery** | Platform scans a folder/convention and auto-registers everything; module just "exists" | Rejected as the primary mechanism. Implicit registration is hard to reason about, hard to make type-safe, creates ordering/conflict ambiguity, and is painful to debug — wrong trade for a small team. |
| **Explicit registration + declarative manifest + derived wiring** | Module is registered *once* (one explicit entry); the platform *derives* all wiring by reading its manifest | **Recommended.** |

### The recommended architecture, stated precisely

> **Explicit registration, declarative manifest, derived wiring.**
> A module is added to the Registry by a single explicit registration. From that one manifest, the platform *derives* every integration generically. Registration is explicit (debuggable, type-safe, validated, order-controlled); wiring is automatic (no per-module edits to the machinery).

The key distinction the question asks for — *single manifest? automatic discovery? explicit?* — resolves as: **single manifest = yes; explicit registration = yes; automatic *discovery* = no, but automatic *derivation* from the manifest = yes.** You list the module once; you never hand-wire its parts.

### What "derived wiring" means per concern

Each of these platform structures should be **composed from the set of registered manifests**, not hand-maintained:

| Concern | Derived from the manifest by | Replaces today's |
|---|---|---|
| Module registration | one explicit Registry entry | `MODULE_REGISTRY` entry (already close) |
| Schemas | platform composes declared document/object types into the schema (each carrying the universal tenant key) | hand-edited schema type array |
| Pages | declared page types + labels + routes feed nav and routing | structure builder + route wiring (extends ADR-010) |
| Collections | declared collection types feed module-grouped nav | structure builder (extends ADR-010) |
| Permissions | declared permission definitions merge into the permission system; assigned via membership | hand-edited permission set |
| APIs | declared service/route contracts mount at conventional paths | hand-wired routes |
| Frontend | declared section/component bindings build the renderer's section map | hand-edited `SectionRenderer` case list |

The single architectural assertion behind the table: **the schema set, the renderer's section map, the navigation, the permission set, and the API surface are all *projections of the registered manifests*, not hand-maintained lists.** That is what makes vertical-slice ownership (Q3) real and what turns §9's promise into a design.

### Validation at registration

Because registration is explicit, the platform can **validate each manifest when it registers** — id uniqueness, dependency resolution (required deps present and version-compatible), platform compatibility, store declarations well-formed — and fail fast at build/boot rather than at runtime. This is consistent with ADR-007 (every commit deployable): a malformed module fails the build, not production.

**Recommendation:** add a new section, *Module Registration Architecture*, stating "explicit registration, declarative manifest, derived wiring," the per-concern derivation table, and build-time manifest validation. This is the section most needed before acceptance.

---

## 6. Module categories

**Acknowledge it; reserve the field; keep it strictly non-functional.** The reviewer is right that this is administrative, not technical, and right that it is not needed today.

- **Reserve a `category` field** in the manifest (Core, Content, Commerce, Communication, Community, Operations, Integrations as an illustrative starting taxonomy), for admin grouping and future marketplace browsing.
- **Behaviour must never branch on category.** No `if (category === 'core')` logic anywhere — that would turn a human taxonomy into hidden coupling. Category is for people (organisation, filtering), not for the machinery.
- **Do not encode functional traits as categories.** If "Core" modules must be non-removable or always-installed, express that as an explicit capability flag (e.g. `removable: false`), not inferred from the category string. Keep category purely descriptive.
- **Don't over-specify the list now** — it will grow; document the starting set as illustrative, not closed.

**Recommendation:** ADR-011 should acknowledge categories as reserved, non-functional manifest metadata, with an explicit rule that no logic may depend on category.

---

## 7. Registry abstraction — adopt the five-layer model as the spine

**Yes. This is the best structural change available and it subsumes Q1 and Q5.** The proposed chain is the technology-independent vocabulary ADR-011 is missing:

```
Module Definition  →  Module Manifest  →  Module Registry  →  Module Installation  →  Module Runtime
```

| Layer | What it is | Answers |
|---|---|---|
| **Module Definition** | the capability itself — code, components, services, assets | *what the module is* |
| **Module Manifest** | the declarative descriptor of the definition; the contract surface the platform reads | *what the module declares about itself* |
| **Module Registry** | the catalog of known manifests | *what the platform knows exists* |
| **Module Installation** | a project's adoption of a module (version conformed to, config, enabled state) | *what a project has* |
| **Module Runtime** | the live, resolved capability executing for a given project and request | *what actually runs* |

### Why this is the right spine

- **It is technology-independent** — not one layer names a tool. It is the durable answer to Q1: the body reasons in layers, and the binding table maps layers to today's implementations.
- **It supplies the missing Runtime layer (weakness #3).** Runtime is where `manifest + installation + tenant context → what renders/executes` is resolved per request. This is the precise home for §7's argument: the **Runtime is always the latest deployed Definition** (single shared runtime), while the **Installation** records the version the project's content conforms to. "Version = migration state" stops being prose and becomes a statement about which layer holds which fact. It is also the natural analogue of the platform's existing design-system resolution (`resolveDesignSystemInheritance` resolving a chain into what renders) — the same pattern, raised to modules.
- **It gives every existing section a home.** §1 → Definition; §9 → Manifest; §3 → Registry; §4/§5/§8 → Installation; §7/§10/§11 cut across Manifest and Runtime; and Runtime becomes the new, explicitly named layer that registration (Q5) targets.

### One caution

Five layers is the right number; resist adding more (no "Module Instance per request" sub-layer, etc.) — that would over-formalise. The model earns its keep precisely because it is small and each layer answers a different, necessary question.

**Recommendation:** adopt the five-layer model as ADR-011's organising spine, re-express the sections against it, and use it (plus the binding table) as the mechanism that makes the ADR technology-independent.

---

## Additional principles recommended (beyond ADR-011's current list)

1. **Express architecture in abstractions; bind to technology in exactly one place.** Content Store, Operational Store, Module Definition/Manifest/Registry/Installation/Runtime are the vocabulary; the binding table is the only place tools are named.
2. **Name assumptions you cannot abstract.** The single shared runtime is a Deployment Topology Assumption; conclusions that depend on it are traceable to it.
3. **A module is a vertical slice** — it owns its capability, configuration *schema*, UI, permission *definitions*, and documentation; the project owns values, content, and assignments; the platform owns generic infrastructure.
4. **Explicit registration, declarative manifest, derived wiring.** Register a module once; the platform derives schemas, pages, collections, permissions, APIs, and frontend from its manifest. Platform structures are projections of the registered manifests, not hand-maintained lists.
5. **Validate manifests at registration; fail at build, not at runtime.**
6. **Prefer optional integration over required dependency.** A module should install and function standalone wherever practical; required dependencies are rare and justified.
7. **Project Settings is an admin configuration domain of independent areas;** Modules is one area, and a Module Installation is a first-class entity, never a field on the project document.
8. **Category is taxonomy, not behaviour.** No logic may branch on a module's category.

---

## Recommended changes before ADR-011 is accepted

In priority order:

1. **Add the five-layer model (Q7) as the organising spine,** and re-express existing sections against it. *(Highest structural value; subsumes Q1 and Q5.)*
2. **Add a "Terminology & Technology Bindings" section (Q1)** with the abstraction→implementation table; sweep the body to use abstractions; convert the single-runtime claim into a named Deployment Topology Assumption.
3. **Add a "Module Registration Architecture" section (Q5):** explicit registration, declarative manifest, derived wiring; the per-concern derivation table; build-time manifest validation. *(Largest functional gap.)*
4. **Reframe §4/§8 (Q2):** Project Settings as a configuration domain; Modules as one area; `ModuleInstallation` as a first-class entity, not a field on the project document; only Modules built now.
5. **Split dependencies into required vs optional (Q4)** in the manifest, and add the "prefer optional integration" principle.
6. **Add the vertical-slice ownership principle (Q3)** as the three-way ownership table.
7. **Acknowledge `category` as reserved, non-functional metadata (Q6),** with the rule that no logic depends on it.

### What does *not* need to change

- The core conclusions are sound: definition-vs-installation split, single registry / many consumers, content-vs-operational storage framework, contract-not-storage, admin-controlled schema updates, the two-lifecycle model. The review tightens *how they are expressed*, not *what they conclude*.
- The phased caution (build the simplest thing now, name the destination) is correct and should be preserved — every recommendation above is "name the architecture, build only Modules," not "build all of it."

**Net:** ADR-011 is close. With the five-layer spine, the binding table, and the registration section added — and §4/§8, dependencies, ownership, and category adjusted — it becomes technology-independent, complete, and safe to accept.
