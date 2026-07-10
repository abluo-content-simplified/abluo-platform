# ADR-011 — Module Management Architecture

**Status:** Proposed — Revision 1 (acceptance-ready; analysis & documentation only)
**Date:** 2026-06-26
**Revision:** 1 (raises abstraction level, adds the five-layer backbone and the Module Installation Architecture; conclusions of the original draft are unchanged)
**Supersedes:** —
**Superseded By:** —
**Builds on:** ADR-009 (Pages, Collections, and Modules), ADR-010 (Module-Driven Studio Navigation)

> This document is an architectural proposal. It defines no schemas, proposes no
> migrations, and changes no code. It describes the long-term architecture of
> Module Management in technology-independent terms, and records today's
> implementation separately in an appendix. Where it implies future code or
> schema work, that work is named so it can be scheduled as discrete, individually
> deployable phases — not undertaken as part of accepting this analysis.

---

## Context

ADR-009 established the conceptual model — *Pages own presentation, Collections own data, Modules own capabilities*. ADR-010 made administration navigation module-driven and deferred module *management* — installation, versioning, configuration, licensing — to this ADR.

The original ADR-011 draft reached the right conclusions but described several of them at the level of today's tools and today's data shapes. Revision 1 keeps every conclusion and raises the description one level: it reasons about **architectural responsibilities**, names today's products only in a single binding table and one explicit assumption, and adds the two pieces the draft was missing — a first-class **Module Runtime** layer and a **Module Installation Architecture** (how a module becomes part of the platform).

The objective is a document that remains valid even if Abluo changes technologies, that is explicit where a current platform assumption genuinely affects the architecture, and that is ready to become a core architectural decision.

---

## Terminology & Technology Bindings

The architecture is described using the concepts below. Products are named **only** in the right-hand column. If a product is replaced, only this table changes; every principle in the document still reads true.

| Architectural concept | Responsibility | Current implementation |
|---|---|---|
| **Module Definition** | The capability itself — code, components, services, assets | TypeScript modules in the shared codebase |
| **Module Manifest** | The declarative descriptor a module publishes about itself | A typed declaration object (today an entry in `MODULE_REGISTRY`) |
| **Module Registry** | The authoritative catalog of known manifests | In-code registry constant (today `MODULE_REGISTRY` in Studio config) |
| **Module Installation** | A project's adoption of a module and its state | `enabledModules` on the project document (today) |
| **Module Runtime** | The live, resolved capability executing for a project/request | Next.js runtime + Administration UI |
| **Content Store** | Editorial, structured, publishable, localized content | Sanity |
| **Operational Store** | Relational, transactional, per-user, operational data | Supabase |
| **Administration UI** | The platform-admin surface for managing projects | Sanity Studio (today); Abluo CMS (future client surface) |
| **Tenant key** | The universal per-tenant identifier | `projectSlug` (Content Store); project-scoped RLS (Operational Store) — ADR-001 |

> **Reading rule:** the body uses the left column. "Content Store," not "Sanity." "Module Definition," not "TypeScript." The one deliberate exception is the Deployment Topology Assumption below, which is intentionally technology-aware because it changes the architecture.

---

## Deployment Topology Assumption (explicit, technology-aware)

One fact is **not** abstracted away, because it is not an implementation detail — it materially shapes versioning and runtime resolution. Abluo currently operates as:

- **one shared codebase**,
- **one deployed runtime**,
- **one Content Store**,
- **one Operational Store**.

The consequence, carried throughout this ADR: **two projects cannot run two different versions of a module's Definition at the same time.** Whatever is deployed is the single implementation every tenant runs. Therefore a project's recorded module version is *not* a parallel running code version — it is the version the project's **content and configuration conform to** (see *Versioning*). Every conclusion that depends on single-runtime topology is traceable to this assumption. If Abluo ever moves to isolated per-tenant runtimes, the versioning section — and only it — must be revisited.

---

## The Five-Layer Backbone

A module's whole existence is described by five conceptual layers. They are the backbone of this ADR; every later section attaches to one or more of them.

```
Module Definition  →  Module Manifest  →  Module Registry  →  Module Installation  →  Module Runtime
   (what it is)        (what it declares)   (what exists)        (what a project has)    (what runs)
```

### Layer 1 — Module Definition

**What the module *is*.** The Definition is the capability itself: frontend components and renderers, service functions, declared content/operational schemas, permission checks, background jobs, documentation. It is executable and therefore lives in code (current implementation: TypeScript). The Definition is what a developer builds and what a future marketplace would package and ship. It is versioned with the codebase.

### Layer 2 — Module Manifest

**What the module *declares about itself*.** The Manifest is the declarative descriptor every Definition publishes. It is the single surface the platform reads to understand and wire a module. It declares identity, capabilities, the pages/collections/settings/permissions/jobs the module owns, its dependencies and optional integrations, its data-store requirements, its contracts, its category, and its lifecycle metadata (version, status, compatibility, changelog). The Manifest is the contract between a module and the platform — see *Module Installation Architecture* and *Contracts*.

### Layer 3 — Module Registry

**What the platform *knows exists*.** The Registry is the authoritative catalog of known Manifests (current implementation: an in-code registry). It is described as **one authoritative registry** — a single resolved catalog the platform consumes — which deliberately leaves room for future *source* registries (marketplace, customer, internal) that resolve *into* it. The Registry has many consumers (administration navigation, the frontend renderer, the permission system, the settings UI, the future CMS) and exactly one authoritative resolution. Multiple authoritative registries would reintroduce the drift that the platform's single-source conventions (e.g. the single design-system field projection, ADR-004) exist to prevent.

### Layer 4 — Module Installation

**What a *project* has.** An Installation is a project's adoption of a module: which module, the version its content conforms to, its configuration values, its enabled/disabled state, and its provenance. Installation is per-tenant operational fact that changes without a deploy. It is the layer that the project lifecycle (*Available → Installed → Configured → … → Removed*) describes. *This ADR defines Installation as an architectural concept and deliberately leaves its persistence model open — see Project Settings & Installation.*

### Layer 5 — Module Runtime

**What actually *runs*.** The Runtime is the live capability resolved for a given project and request. It is the layer that combines **Definition + Manifest + Installation + tenant context** into executing behaviour. The Runtime is now a first-class concept because several responsibilities have no other home: they are not what a module *is*, nor what it *declares*, nor what a project *has* — they are what the platform *runs* on a module's behalf.

The Runtime layer contains:

- **Frontend capabilities** — the section/component renderers a module contributes, mounted for the tenant.
- **APIs / services** — the module's executing public and platform contracts (see *Contracts*).
- **Background jobs** — scheduled work the module declared, executed per installed project.
- **Permissions enforcement** — evaluation of the module's declared permissions against tenant membership.
- **Navigation projections** — the administration navigation and (separately) website-navigation surfaces derived from installed modules. *Navigation is a projection of the Runtime, not a property of the Installation* — this is why administration navigation reflects installed modules (ADR-010) while website navigation remains independent (ADR-009).
- **Configuration resolution** — resolving a module's effective configuration (Manifest defaults overlaid by Installation values) for the current tenant.
- **Other runtime services** — capability detection for optional integrations, update-availability evaluation, and contract brokering between modules.

Because of the Deployment Topology Assumption, the Runtime always resolves the **latest deployed Definition**; the Installation's recorded version describes only how far the project's content has been migrated to match it. The Runtime is the direct analogue of the platform's existing design-system resolution (a chain resolved into what renders) raised to the level of modules.

### How the original sections map onto the backbone

| Layer | Owns these concerns |
|---|---|
| Definition | What a module is; ownership of capability/UI/code |
| Manifest | Declaration; contracts; dependencies; storage declaration; category; versioning metadata |
| Registry | Authoritative catalog; one authoritative registry; consumers |
| Installation | Project ↔ module relationship; configuration values; enabled state; project lifecycle; Project Settings |
| Runtime | Frontend, APIs, jobs, permissions enforcement, navigation projection, config resolution, update detection |

---

## Module Installation Architecture

*This is how a module becomes part of the platform — from the platform's perspective, not the user's. It is the section the original draft was missing.*

When a new module is introduced, three things are true in sequence: it is **registered explicitly**, it **declares everything in one manifest**, and the platform **derives all wiring from that manifest**.

```
Explicit registration  →  Declarative manifest  →  Platform derives everything else
```

### Why not the alternatives

| Model | How a module wires in | Verdict |
|---|---|---|
| **Manual / scattered** | Hand-edit navigation, the renderer's section map, the schema set, the permission set, the route table — per module | Rejected. The "new section checklist" problem at module scale: error-prone, unscalable, breaks vertical-slice ownership. |
| **Automatic discovery** | Platform scans a convention/folder and auto-registers everything implicitly | Rejected as the primary mechanism. Implicit registration is hard to reason about, hard to validate, ambiguous on ordering/conflicts, and painful to debug. |
| **Explicit registration + declarative manifest + derived wiring** | Register once; the platform derives all integration by reading the manifest | **Adopted.** |

The chosen model keeps registration **explicit** (debuggable, type-safe, order-controlled, validatable) while making wiring **automatic** (no per-module edits to platform machinery). The distinction the question turns on: *single manifest = yes; explicit registration = yes; automatic discovery = no, but automatic **derivation** from the manifest = yes.* A module is listed once; its parts are never hand-wired.

### What the platform derives from the manifest

Each platform structure below is a **projection of the registered manifests**, not a hand-maintained list:

| Registration concern | Derived from the manifest as | Layer |
|---|---|---|
| **Module registration** | one explicit entry in the authoritative Registry | Registry |
| **Schemas** | declared content/operational schemas composed into the platform's schema set, each carrying the tenant key | Definition → Runtime |
| **Pages** | declared page types + administration labels + routes feed navigation and routing | Runtime |
| **Collections** | declared collection types feed module-grouped administration navigation | Runtime |
| **Permissions** | declared permission definitions merge into the permission system; assigned via tenant membership | Runtime |
| **APIs** | declared service/route contracts mount at conventional paths | Runtime |
| **Frontend capabilities** | declared section/component bindings build the renderer's section map | Runtime |

The single assertion behind the table: **the schema set, the renderer's section map, the navigation, the permission set, and the API surface are all projections of the registered manifests.** That is what turns "add a manifest, nothing else changes" from a promise into a design, and what makes vertical-slice ownership real.

### Build-time validation of manifests

**Yes — manifest validation should be part of the architecture, and it should run at build time.** Because registration is explicit, the platform can validate every manifest before anything runs:

- identity is unique;
- declared dependencies resolve and are version-compatible (required dependencies present);
- platform compatibility is satisfied;
- data-store declarations are well-formed;
- declared capabilities are internally consistent (a module that declares pages also declares their types, etc.).

A malformed manifest fails the **build**, not production — consistent with ADR-007 (every commit deployable). Build-time validation is what makes explicit registration safe to scale to dozens of modules.

---

## Module Ownership

A module is a **vertical slice**. The three-way split below is a guiding principle of this ADR; it both adopts the "module owns its slice" idea and stays consistent with ADR-009/010 (a module owns the *shape*; a project owns the *values*).

| Owner | Owns |
|---|---|
| **Module** | its capability; its configuration **schema**; its documentation; its permission **definitions**; its public contract |
| **Project** | the configuration **values**; the content; the installation state |
| **Platform** | the infrastructure; rendering; scheduling; update management; administration |

Read across the rows: the module *declares and implements*, the project *supplies values and content*, the platform *runs the generic machinery*. No responsibility is split ambiguously, and the machinery has no per-module special cases — which is only achievable because registration is declarative (*Module Installation Architecture*). Ownership and manifest-driven registration are a pair: neither works without the other.

---

## Contracts

A module exposes **contracts, not storage** (this reinforces, and is reinforced by, *Data Ownership & Storage*). Revision 1 distinguishes two contracts a module publishes, because they have different audiences and stability guarantees.

### Platform Contract

**Consumed by the platform itself.** It is what the Manifest declares so the platform can wire and run the module:

- pages
- collections
- settings (configuration schema)
- permissions
- jobs
- dependencies and optional integrations

The platform reads the Platform Contract to derive navigation, the settings UI, permission enforcement, scheduling, and routing (*Module Installation Architecture*).

### Public Contract

**Consumed by other modules.** It is how a module exposes capability to its peers:

- services
- APIs
- queries (capability-level, not store-level)
- business capabilities

Other modules depend on the Public Contract and **never** on the underlying store. Whether a module's data lives in the Content Store, the Operational Store, or both is invisible across the boundary. This is what lets a module evolve its storage (e.g. a Team module moving from Content-Store-only to hybrid) without breaking any consumer, and it is the precondition for optional integrations and for any future third-party module.

> **Modules expose contracts, not storage.** A module owns its capability, not necessarily its storage. Within a module, code may touch its own store directly; *across* module boundaries, only contracts. Enforcement tightens (single-source conventions, an architecture/lint rule against cross-module store access) as the first multi-store module lands.

---

## Dependencies — required vs optional

A module declares two distinct relationship kinds. They are different architectural concepts and must not be one list.

| | Required dependency | Optional integration |
|---|---|---|
| Meaning | the module cannot function without the other | the module is enhanced by the other; degrades gracefully without it |
| Example | **Booking requires Forms** | **Booking integrates with CRM**; **Team integrates with Calendar** |
| Resolved | at installation — hard, version-ranged | at runtime — soft, capability-detected via the Public Contract |
| If the other is absent/removed | install is blocked / removal is blocked while depended upon | no effect; the integration simply stays dormant |
| Coupling | hard | optional, safe |

### Prefer optional integrations — and why

Required dependencies create hard coupling that undermines independent installability and independent development (ADR principle: modules are independently developable). Every required dependency makes two modules a single unit for installation and lifecycle purposes. **Optional integrations preserve loose coupling:** a module installs and functions standalone, and *opportunistically* lights up richer behaviour when a peer's Public Contract is present — detected through the contract, never by reaching into the peer's store. Optional coupling is therefore safe coupling, and it is what keeps a growing module ecosystem composable rather than entangled. The architecture should **prefer optional integration over required dependency**, reaching for a required dependency only when the capability is genuinely impossible without the other module.

---

## Data Ownership & Storage

*Conclusions unchanged from the original draft; expressed in store-abstraction terms.* A module **declares where its authoritative data lives** in its Manifest, using a consistent framework rather than a per-module judgement call.

### The decision framework

Route data by its nature, in order:

1. Composed and published by an editor, like content (drafts, rich text, media, references, localized strings, SEO)? → **Content Store.**
2. Operational — relational, transactional, per-end-user, written by the application at runtime, queried by relationships, or high-write? → **Operational Store.**
3. Requires editorial workflow (draft/publish, versioning, asset pipeline, content localization)? → **Content Store.**
4. Requires transactional integrity, per-user row security, or relational querying? → **Operational Store.**
5. Has both faces? → **Hybrid**, with a clear seam: the Content Store holds the editorial face keyed by a stable id; the Operational Store holds operational rows referencing that id.

| Module | Content Store | Operational Store | Result |
|---|---|---|---|
| Blog | content, SEO, media, publishing | — | Content Store |
| CRM | — | customers, interactions, activities, reporting | Operational Store |
| Shop | marketing copy, descriptions, images | SKU, price, inventory, VAT | Hybrid |
| Team (today) | profiles, bios, photos | — | Content Store |
| Team (future) | profiles, bios, photos | accounts, permissions, scheduling | Hybrid |

The Team row is the point: a module can **start single-store and evolve to hybrid** without changing what it *is*, because consumers depend on its Public Contract, not its store. The Manifest declares **primary store, optional secondary store, synchronisation requirements, and external dependencies** — making provisioning, backup, and compliance auditable from the Manifest. A module choosing the Operational Store inherits the platform's tenancy model (the tenant key); it does not invent its own.

---

## Versioning

*Conclusions unchanged.* Each module is **independently versioned** with a semantic version on its own cadence, declared in the Manifest alongside compatibility, changelog, and migration metadata. Module version is unrelated to platform version or to any other module's version.

Per the **Deployment Topology Assumption**, a project's recorded `version` is the version its **content and configuration conform to** — its content-migration state — not a parallel running Definition. This reframes updates precisely:

| Update kind | Example | Propagation | Per-project gate |
|---|---|---|---|
| **Non-breaking** | bug fix, new frontend variant, additive optional field | ships with the single deployed runtime — platform-wide, automatic | none |
| **Schema / breaking** | new required field, changed type, new collection, reshaped data | code ships platform-wide, but each project's content must be migrated to conform | **administrator-controlled** |

The platform's Runtime compares each Installation's version against the authoritative Registry's current version and surfaces **"update available"** in administration. Schema-affecting updates are **administrator-controlled** — never a silent migration of live tenant content — consistent with the platform's schema-evolution discipline and ADR-007. Non-breaking updates are inherently platform-wide and need no gate.

---

## Lifecycle — Platform vs Project

*Conclusions unchanged.* Two separate lifecycles, two owners, meeting only at version.

**Platform lifecycle** — owned by the module as a product, global, stored in the Manifest + Registry metadata:

```
Draft → Released → Updated → Deprecated → Archived
```

**Project lifecycle** — owned by each Installation, per-tenant, stored in the Installation record:

```
Available → Installed → Configured → Content Created → Published → Disabled → Removed
```

They meet at **version**: a project installs *a* version; the platform's latest may have moved ahead.

A required clarification (constraint: *installing enables editing, not publication*): `Published` in the project lifecycle is **not** a module-level flag. It is the state in which the project has published content the module produces *and* exposed it on the website — governed by per-document publish status and website navigation (independent of installation), not by the install flag. Installation makes a capability **editable**; publication makes its output **visible**. The two axes stay orthogonal.

---

## Project Settings & Installation

Two concerns the original draft blended, now separated — and one decision deliberately left open.

### Information Architecture

Project Settings should eventually become a richer **administration area** — the platform-admin configuration of a project — containing independent sections such as:

- Modules
- Domains
- Locales
- Analytics
- Deployment
- Permissions
- Integrations
- Billing

**Modules becomes one section within Project Settings**, alongside the others, extending the Settings area ADR-010 introduced. Each section is an independent configuration area that can evolve on its own. *Only Modules is built now;* the rest are named as the destination architecture, not implemented — consistent with "the simplest version that proves the concept."

Module management operations (read installations, detect updates, validate configuration against the Manifest, enable/disable) should live in a **shared platform service** so both the current Administration UI and the future client CMS reuse them rather than duplicating logic.

### Data Model — left open

This ADR defines **Module Installation as an architectural concept** (Layer 4): a project's adoption of a module, with version, configuration, enabled state, and provenance. It deliberately does **not** decide the persistence model. Whether an Installation is ultimately:

- a field on the project record,
- its own first-class entity, or
- another persistence model,

is an implementation decision left to the phase that builds it. Stating the concept without fixing the persistence keeps ADR-011 technology-independent and lets the storage decision follow the same Content-Store-vs-Operational-Store framework when the time comes (e.g. entitlement and billing data are operational; a navigation projection may live wherever the administration surface can read it).

---

## Module Categories

Modules may eventually declare a **category**, such as:

- Core
- Content
- Commerce
- Communication
- Community
- Operations
- Integrations

Categories are for **administration and discovery only** — grouping in the administration UI and filtering in a future marketplace. **No architectural behaviour depends on a category.** No platform logic may branch on it; a functional trait (for example, a Core module being non-removable) must be expressed as an explicit Manifest flag, never inferred from the category string. The starting list above is illustrative and expected to grow; the field is reserved as non-functional metadata.

---

## Guiding Principles

The principles ADR-011 adopts. The first block is the set the revision brief required to be explicit; the second block is the principles that naturally emerge from the analysis.

**Required, explicit:**

1. **Modules are the unit of installable capability.**
2. **Modules own capabilities.**
3. **Modules own configuration schemas.**
4. **Projects own content.**
5. **Projects install modules.**
6. **Installing enables editing, not publication.**
7. **Modules expose contracts, not storage.**
8. **Modules are independently developable.**
9. **Modules are independently versioned.**
10. **Platform lifecycle and project lifecycle are separate** (and meet only at version).
11. **The platform derives behaviour from manifests** — navigation, settings, permissions, and runtime wiring are projections of registered manifests, not hand-maintained lists.
12. **One authoritative registry** — a single resolved catalog the platform consumes, leaving room for future source registries (marketplace, customer, internal).
13. **Technology is an implementation detail of architectural responsibilities** — the architecture names responsibilities (Module Definition, Content Store, Operational Store, …); products appear only in the binding table.

**Emergent additions:**

14. **A module is a vertical slice:** module owns capability, configuration schema, documentation, permission definitions, and public contract; project owns configuration values, content, and installation state; platform owns infrastructure, rendering, scheduling, update management, and administration.
15. **Explicit registration, declarative manifest, derived wiring** — register a module once; the platform derives everything else from its manifest.
16. **Manifests are validated at build time; a malformed module fails the build, not production.**
17. **A module declares two contracts:** a Platform Contract (consumed by the platform) and a Public Contract (consumed by other modules).
18. **Prefer optional integration over required dependency;** a module installs and functions standalone wherever practical.
19. **A module's authoritative data store is declared in its manifest** and chosen by the editorial-vs-operational framework; a module owns its capability, not necessarily its storage.
20. **The Runtime resolves the latest deployed Definition;** a project's recorded version is its content-migration state, not a parallel running version (per the Deployment Topology Assumption).
21. **Modules inherit the platform's tenancy model** — they do not invent their own.
22. **Module categories are non-functional;** no behaviour depends on them.

---

## Consequences

**Positive:**

- A module is described by five stable, technology-independent layers; each responsibility has exactly one home, including the previously-homeless runtime concerns.
- "Add a manifest; the platform derives everything else" is now a designed mechanism (explicit registration + derivation + build-time validation), not an assertion.
- The architecture survives technology change: replacing the Content Store, Operational Store, or Definition language changes only the binding table.
- The path to CRM, Shop, Booking, Members, and a future marketplace is cleared — each is "publish a manifest, declare a store, expose contracts," with optional integrations keeping the ecosystem composable.
- Every prior conclusion (definition-vs-installation split, authoritative registry, content/operational storage framework, contracts-not-storage, admin-controlled schema updates, two lifecycles) is preserved and expressed more durably.

**Negative / costs to acknowledge:**

- Real implementation work sits behind this analysis: relocating and generalising the registry, defining the manifest, building the derivation machinery and build-time validation, the shared management service, and the Project Settings area. Each is its own deployable phase under ADR-007.
- The contracts-not-storage discipline needs active enforcement or it erodes.
- Cross-module reporting cannot rely on a single-store join and must be composed at the contract layer.
- Leaving the Installation persistence model open is correct for this ADR but defers a decision that the building phase must make against the storage framework.

---

## Appendix — Current Implementation Mapping

For orientation only. Architecture is in the body; this records where today's platform sits against it.

| Concept | Today |
|---|---|
| Module Definition | TypeScript modules in the shared codebase |
| Module Manifest | `MODULE_REGISTRY` entry (`id`, `label`, `pageType`, `collectionItems`) — a partial manifest; the full manifest is the target shape |
| Module Registry | `MODULE_REGISTRY` constant in Studio config — to be relocated to a platform-level, framework-agnostic location consumed by all surfaces |
| Module Installation | `enabledModules: string[]` on the project document — concept defined here; persistence model intentionally open |
| Module Runtime | Next.js runtime + Sanity Studio (Administration UI); the explicit Runtime layer is a new framing of existing behaviour |
| Content Store | Sanity |
| Operational Store | Supabase |
| Administration UI | Sanity Studio today; Abluo CMS the future client surface |
| Tenant key | `projectSlug` (Content Store) + project-scoped RLS (Operational Store) — ADR-001 |
| Deployment topology | one shared codebase, one runtime, one Content Store, one Operational Store |

> **Deliverable note.** This is an architectural proposal only — no schemas, no code, no migrations. Named future work (registry relocation, manifest definition, derivation machinery, build-time validation, shared management service, Project Settings area, Installation persistence decision) is to be scheduled as discrete, individually deployable phases when ADR-011 is accepted.
