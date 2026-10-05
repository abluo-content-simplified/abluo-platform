# Calls to action at the end of blog posts — setup

**Abluo owns the structure, clients choose.** You prepare the calls to action (CTAs) for a website in Studio. Clients only pick one per post in their dashboard: the website default, another one, or none.

Each CTA is its own small, project-scoped document (`callToAction`). It is the first Website Settings area split out of `siteConfig` (ADR-027).

## Add a CTA (Studio)
1. Studio → **<project>** → **Website Settings** → **Calls to action** → **+** (the new document already has the project set).
2. Fill in:
   - **Internal name**: what clients see when choosing, e.g. "Book a first session". It isn't shown on the website.
   - **Default for blog posts**: tick it on one CTA per website. It shows under every post that hasn't chosen another. Studio refuses a second default.
   - **Heading**, **Short text** (optional) and **Button label** in every website language.
     - A language without a heading AND a button label shows **no** CTA in that language.
     - There is no fallback to another language.
   - **What the button does**, plus its target:
     - Page or Blog post: pick it. Only this project's documents are offered.
     - Contact form: pick a Forms-module form. It opens in the site's usual pop-up.
     - Phone: a number with country code.
     - WhatsApp: a number with country code, plus an optional pre-filled message per language.
     - Email: an address.
     - External URL: a full `https://` address.
3. **Publish** the document. Drafts are never shown on the website or offered in the dashboard.

Deleting a CTA is allowed even when posts chose it: posts hold a *weak* reference. Those posts then simply show no CTA.

## What clients see
- The dashboard overview shows a **Call to action** card only when the website has at least one published CTA.
- **Edit** offers three choices:
  - "Use the site's call to action", with a preview of its heading and button.
  - One of the other CTAs.
  - "None".
- The choice is saved on the post as `cta = { mode: 'default' | 'none' | 'custom', ref }`. `ref` is a weak reference to the callToAction. A post with no choice uses the default.

## Where it lives in code
- Schema:
  - The `callToAction` document and the `callToActionProjectOwned` template in `src/lib/sanity/schema.ts`.
  - The `post.cta` field in `src/lib/modules/blog/schema.ts`.
  - The Studio list in `sanity.config.ts` (Website Settings → General / Calls to action).
- Rules (pure, tested): `src/lib/blog/post-cta.ts`. It holds `resolvePostCta`, `ctaActionTarget` and the action validators.
- Website: `postCallToActionsQuery` (in `src/lib/sanity/queries.ts`) and `src/components/blog/PostCallToAction.tsx`:
  `<PostCallToAction tenantSlug={tenantId} locale={locale} defaultLocale={defaultLocale} cta={post.cta} />`
- Dashboard writes go through `patchPostDraft` in `src/lib/api/post-drafts.ts`:
  - It accepts `cta.mode` and `cta.ref`.
  - The id must be a callToAction of this project; one read checks it.
