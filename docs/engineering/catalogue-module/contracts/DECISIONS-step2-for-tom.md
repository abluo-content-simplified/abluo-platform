# Catalogue V2 — step 2: decisions for Tom

**Date:** 2026-11-02 · **Status:** Decided — superseded by `DECISIONS-step2-final-2026-11-02.md` (Tom, 2026-11-02). Kept for history. Every item below is already applied *provisionally* in the contracts (marked "Provisional — awaiting Tom (REVIEW D-n)"), so a "yes" changes nothing but the marker; a "no" is a targeted edit.
**Contracts (Rev 2):** `C2-C5-C10-…` (channels, formats, prices, availability, migration + the single rollout plan) · `C1-C7-C11-…` (categories & tags, packs, public name) · `C6-C8-C9-C12-…` (readiness, permissions, Studio, audit, + C13 draft allergen evidence). Independent review: `REVIEW-step2-cross-contract.md` (rev 1 findings, all section-E corrections applied in Rev 2).

## Facts the review found that change the picture

1. **The website never shows `navLabel`.** It is dashboard-only; tmz's site shows "Between the Lines", never "Books". The K-2 migration you asked for is still done (it's harmless and keeps the name for later), but it preserves nothing visible today. Any *new* use of the public name on the website is a visible change and is listed separately for your approval (D-12).
2. **Price time windows never affected the public site.** No production code calls the time-based resolver; the site lists every price and JSON-LD always says InStock. So the K-3 change is invisible on the website, and the production equivalence diff is genuinely empty.
3. **There is no development Sanity dataset.** dev, preview and production all read `production`; `staging` exists and is empty. "Dev then production" for data therefore means: readers shipped to production first, rehearsal on `staging` from an export, your approval, then production.
4. **The publish gate has side doors.** Back online, restore and changing dates make a copy public again without the gate. The contracts close this.
5. **Only tmz uses the Catalogue in production** (16 item documents, no channels, Bookshop preset v1). Everything below has zero effect on other clients.

## Decisions that block the model slice (step 3)

| # | Question | Recommendation | Why |
|---|---|---|---|
| D-1 | Where Catalogue settings live | **Module config** for settings (channels, currency, segment, public name, defaults); **own per-project documents** for the category tree, pack history and publication standards — all edited only in Setup | One configuration surface (ADR-014) without stuffing large structures into the project document |
| D-2 | Category storage | **One Catalogue taxonomy document per project** (nodes in arrays) instead of one record per term | Atomic tree moves, cycle safety, packs applied in one transaction; fits Sanity limits. Leaves Amendment J's "one record per term" for the Catalogue only |
| D-3 | Who edits categories, where | **Editors** may create/rename/reorder/delete-unused (incl. **inline "+ Add" while creating an item**); **structure and availability rules** (move between parents, delete in use, channel rules) need the Setup permission. Setup → Categories & Tags is visible to either permission | Your K-4 ("only in Setup") and today's inline creation collide; inline create calls the same service, so there is still one editing implementation. Needs a one-line amendment to K-4 and ADR-042 N2a |
| D-4 | When channels exist, does an item unavailable on every channel still appear on the website? | **Yes** — website presence = lifecycle + visibility; availability decides prices and badges. Hiding becomes a later opt-in setting | Otherwise the migration changes public behaviour |
| D-5 | "Default for new items" vs project default | **One concept**: each channel's default availability is the runtime default; new items store nothing | Two defaults would disagree |
| D-6 | K-3 removes time-based *availability* (breakfast only, delivery after 18:00) | **Accept for now**; the "available now" listing filter becomes "priced now"; availability windows added later only if a tenant needs them | Consistent with K-3; nothing in production uses it |
| D-7 | What "equivalence diff must be empty" means | **Old vs new public result per item × channel × context × fixed instants**, with window-gap cases reported separately (production has none) | A literal resolver-to-resolver diff can't hold by definition after K-3 |
| D-10 | Migration default for projects that do have channels | **Unavailable by default + explicit "available" for every item that was sold** | Conservative; no production impact (no project has channels) |
| D-11 | Data rehearsal path | **Readers to production → rehearse on `staging` from an export → your approval → production**, export kept as rollback | No dev dataset exists; creating one is a separate infra decision |
| D-12 | Public name | Keep the automatic `navLabel` copy (audited). **Separately approve** each new visible use: (a) landing-page title fallback, (b) `llms.txt` heading `## Catalogue` → `## Books` on tmz | These are the only visible changes in the whole model slice |
| D-13 | Preset → pack transition | tmz's `bookshop v1` becomes pack history; Bookshop's default profile becomes **Book** (tmz keeps its current setting); the install flow asks for the URL segment itself | Packs no longer run at install |
| D-14 | "Food setup completed" | Store a separate **setupCompletedAt** fact; pack identity stays guarded | The item editor needs to know; it must not read pack history |
| D-15 | Primary category for legacy data / re-exposure | Primary required only on the **publish** transition (never unpublishes anything); legacy multi-category → first one is primary (one draft in prod); **back online / restore / date changes re-run only a safety subset** (allergen review, choices, dangling references) | Allergen exposure on a re-published copy is legal risk, not a quality matter (agent's extra, I-18 — delete if you prefer the pure rule) |

## Decisions for later slices (not blocking step 3)

| # | Question | Recommendation |
|---|---|---|
| D-8 | Missing price on the website | **Recommended** (warns) on the website; **required** for channels, priced exports, PDFs and marketplaces; packs may make it required for food |
| D-9 | "Blocked" outside the website | Blocks only that context's action (export, PDF, feed), never availability or visibility |
| D-16 | Allergen review | New permission `catalogue.allergen.update` (Owner, Site admin, Editor); never in support mode; review resets when: profile becomes food, option list attached, free-text add choice added/edited, a linked item's declaration changes, the declaration is edited — **not** on name/description/price. *Compliance-critical: please confirm the list* |
| D-17 | Who may override a "recommended" warning | Owner / Site admin |
| D-18 | Studio limits | Accept that read-only Studio is a UI lock (tokens/API can still write); add a detective webhook + daily reconciliation; keep Sanity seats/tokens minimal |
| D-19 | All-or-nothing bulk publish | Build it (one transaction, ≤ 100 documents) in the bulk slice |
| D-20 | Retention of allergen evidence | Decide at the privacy review before the first review record (5 years default vs 10 for allergen) |
| D-21 | Small confirmations | As written in REVIEW D-21 (channel/format/category limits 12 / 24 / 300 / 200 tags; packs reuse `dine-in`/`takeaway` keys; channel deletion only via counted, audited clean-up; etc.) |

## After your answers

1. I fold your answers in (markers removed; K-4 and ADR-042 N2a amended for D-3; ADR-033 D3 amended for D-1).
2. Contracts become **Accepted**; Amendment K §K-11 points at them; the v1 spec gets its v2 sections.
3. Step 3 (model + migration) is ready to start **after billing is promoted** — rollout plan in C10-6 (M0 audit table → R1 readers → staging rehearsal → your approval → R2 writers + Setup → data steps → R3 cleanup).
