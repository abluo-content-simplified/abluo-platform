# Per-project isolation and discoverability — kickoff

**Status:** not started. One preparatory branch exists (see §4).
**Owner:** Tom
**Why this document:** the work below was found one bug at a time during a
No!Logo SEO audit. That is the wrong way to find it. This states the rule first
so the platform can be tested against it.

---

## 1. The rule

> Abluo is one codebase serving many tenants. A tenant has one or more projects.
> **Every public artefact a project emits describes that project and nothing
> else.** No project's content, URLs, identity or metadata may appear on another
> project's site — in the page, in the head, in a machine-readable file, or in
> structured data.

The only exception is one a tenant agrees to commercially: a "made with Abluo"
footer link. That is authored per project like any other link, never emitted by
default.

This rule is already enforced well in **routing and data access** — there is a
generated route table, a tenant-scoped Sanity client, a scoping guard, and a
large test suite behind it. It was **not enforced at all in the SEO and metadata
layer**, which had no tests. Every defect in §3 lived there.

---

## 2. The second rule

> Shared code must contain no tenant-specific fact.

A shared component is rendered for every project. A literal typed into one —
a country, a year, a business type, a brand name, a founding date — is asserted
on behalf of every tenant. This is the class of bug in §3.2, and it recurred
three times in the same file because nothing tested for it.

---

## 3. What was already found

### 3.1 The sitemap listed every client on every domain — FIXED on the branch

`src/app/sitemap.ts` built one list of all active projects and served it
identically on every host. `livener.net/sitemap.xml` carried 31 URLs across five
client domains — `abluo.app`, `ch-psicoterapeuta.com`, `studiomartegani.com`,
`nologo.cloud` — and so did every other client's sitemap.

This was a genuine cross-project data leak: the file is public, so each client's
sitemap disclosed the whole client list. Now filtered by request host; an
unrecognised host gets an empty sitemap rather than everyone's.

### 3.2 Hardcoded tenant facts in shared structured data — FIXED on the branch

`src/components/JsonLd.tsx` was originally written for Studio Martegani, with
literals typed into it. Because it is shared, every project emitted them:

| literal | asserted for | status when found |
|---|---|---|
| `'@type': 'Dentist'` | every tenant, incl. a psychotherapist | already fixed by an earlier session; its comment documents it |
| `foundingDate: '1991'` | Livener, Abluo, No!Logo, all of them | **still live** |
| `addressCountry: 'IT'` | incl. Livener, registered in England | **still live** |

Note the shape of it: the first was found and fixed, and the two beside it were
not noticed. That is what an absent test looks like.

**No client content ever crossed between projects here.** These were literals in
a code file, rendered into the machine-readable block, invisible on the page.
Nothing from one tenant's Sanity dataset appeared on another's site.

Related, same file: `businessType` was projected only by
`siteConfigFaviconQuery`, which `JsonLd` never calls — so a type set in Studio
never reached the structured data. Hoffmann is set to `Psychologist` and was
published as `LocalBusiness` regardless.

### 3.3 The project segment in every public URL — FIXED on the branch

Ten metadata functions built canonicals as
`https://<customDomain>/<locale>/<projectSegment>/…`, putting the internal
rewrite target into the address given to search engines. Both spellings answer
on a custom domain, so nothing broke and nothing failed — `livener.net/en`
simply declared its canonical as `livener.net/en/livener`, and would have had
No!Logo indexed as `nologo.cloud/en/nologo`.

Not a leak, but the same root cause: no test asserted the shape of a public URL.

---

## 4. What exists already

Branch **`seo/pre-launch`**, one commit **`26014fa`**, branched from `dev` at
`cdbaf6e`. Merges cleanly. `tsc` clean, 2196 tests across 92 files, 27 of them
new. **Not pushed. Not merged. No Sanity document was touched.**

It contains: the three fixes above, `x-default` hreflang, page-level SEO fields
(`seoTitle`, `seoDescription`, `ogImage`, `noindex` — none existed, so no page
but the home page could have a meta description), a host-scoped `/llms.txt`,
and `sameAs` / `logo` / `WebSite` in the structured data.

**Caveat:** type- and unit-verified only. `next build` bus-errors in the cloud
sandbox and no dev server was running, so nothing on this branch has been
checked in a browser. Do that first.

Also on disk, not applied: `docs/engineering/nologo-seo-content-proposal.md` —
the No!Logo content changes this branch enables, awaiting review.

---

## 5. The work

### 5.1 Write the rules down as tests
The point of this whole effort. Roughly:

- **No tenant literal in shared code.** Scan `src/components` and `src/lib` for
  ISO country codes, four-digit years, schema.org business types and known
  tenant names appearing as literals. Allowlist the legitimate ones (the
  staging-host pattern, the locale registry) explicitly, so an addition to the
  allowlist is a reviewed decision.
- **No cross-project output.** For every public artefact — sitemap, llms.txt,
  robots, feeds, structured data — assert that rendering it for project A
  mentions no domain, slug or name belonging to project B. Drive it from the
  generated route table so onboarding a project extends the test automatically.
- **Public URL shape.** Already done in `src/lib/seo/__tests__/public-url-shape.test.ts`;
  extend it as new routes appear.

### 5.2 Audit the rest of the surface against the rule
The SEO layer was audited. These were not, and each is shared code that emits
something public: RSS/feeds if any, OG image generation, the 404 page, error
pages, email templates (`src/lib/notifications`), the forms API responses,
`TrackingScripts`, and anything reading a project's data without
`tenantClient()`.

### 5.3 Per-project SEO/AEO completeness
Tom's requirement: *"for every project we must be able to generate everything —
SEO, AEO — but separate."* Today an editor cannot tell whether a project is
ready to be found. Proposal: a per-project readiness view listing what is set
and what is missing — canonical domain, OG image, verification tokens,
per-page titles and descriptions in every supported locale, structured-data
type, privacy and legal pages, analytics. Data already in Sanity; this is a
reading and presentation job, not new plumbing.

### 5.4 Consequences of the default change
`businessType` now defaults to `Organization` rather than `LocalBusiness`
(`LocalBusiness` asserts a physical place of business; a default should not make
a claim). Two projects should be set explicitly:

- Studio Martegani → `Dentist`, `addressCountry: IT`
- Livener → `Organization`, `addressCountry: GB`

---

## 6. Constraints for whoever picks this up

1. **Livener, Studio Martegani, Hoffmann, Abluo and tmz.it are live.** Shared
   code changes reach all of them. Verify against each before merging.
2. **Never invent or alter client copy.** Not a headline, not a tagline, not a
   translation. If a string is needed and does not exist, propose it and stop.
   This has gone wrong before.
3. **Verify in a browser.** `tsc` passing and tests passing is not evidence a
   page renders. `next build` bus-errors in the cloud sandbox; use the dev
   server on Tom's Mac (`nologo.localhost:3000`, `livener.localhost:3000`,
   `studiomartegani.localhost:3000`).
4. **Ask before touching Sanity.** Several projects are edited in parallel.
5. Tom commits from his own terminal unless he says otherwise.

---

## 7. Open decisions for Tom

- Merge `seo/pre-launch` into `dev` now, or hold it until this larger pass is
  done and ship them together?
- Should the nav label for the No!Logo restaurant page be its own page title, or
  a shorter "For Restaurants"? (The latter is new copy in seven languages.)
- Privacy and legal text for No!Logo — both footer links are dead today.
- An Open Graph image for No!Logo (1200 × 630). Without one, every share of the
  URL renders a blank card.
