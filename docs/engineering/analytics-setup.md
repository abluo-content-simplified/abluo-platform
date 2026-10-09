# Analytics setup — Google Analytics 4 + Search Console

ADR-029 §3.4 (client dashboard) and ADR-030 §5.2 (admin). How the numbers get
from Google into the dashboards, and what Tom and each client have to do once.

```
Studio (property IDs) ─┐   ← written by "Connect Google" (admin project page), or by hand
                       ├─► /api/cron/analytics (daily, 04:30 UTC) ─► Supabase analytics_snapshots ─► dashboards
Env (service account) ─┘        GA4 Data API + Search Console API
```

- **One Abluo service account** reads every client's data. Clients add it as a
  read-only user on their own Google properties. Nobody signs in to Google from
  the dashboards.
- **Daily snapshots, never live calls.** The job stores the last 28 days
  (ending yesterday, UTC), the 28 days before, the last 7 and the 7 before.
  Pages read the stored row, so they are fast and keep working when Google is down.
- **Who sees it:** client Owner and Site admin; an Editor only with the
  "Sees website analytics" extra (permission `analytics.read`). Abluo admins see
  everything in admin → Analytics (each view is written to the admin audit log).

---

## 1. Google Cloud: the service account (once, Tom)

1. Open <https://console.cloud.google.com/> and create a project, e.g. **abluo-analytics**.
2. **APIs & Services → Library**, enable both:
   - **Google Analytics Data API**
   - **Google Search Console API**
3. **IAM & Admin → Service accounts → Create service account**, e.g.
   `abluo-analytics`. It needs **no** project roles (skip "Grant access").
4. Open the account → **Keys → Add key → Create new key → JSON**. A file downloads.
   Keep it out of the repo and out of client folders; you only need two values from it:
   - `client_email` → e.g. `abluo-analytics@abluo-analytics.iam.gserviceaccount.com`
   - `private_key` → the `-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----` text

## 2. Vercel environment variables (once, Tom)

Project **abluo-platform → Settings → Environment Variables**, for Production
(and Preview/Development if you want to test there):

| Name | Value |
|---|---|
| `GOOGLE_ANALYTICS_SA_EMAIL` | the `client_email` |
| `GOOGLE_ANALYTICS_SA_PRIVATE_KEY` | the `private_key`, pasted as is. A one-line value with literal `\n` also works. |
| `CRON_SECRET` | already set for the other cron jobs — nothing to do |

Redeploy after adding them. Never put these in Sanity or in `.env` files in client folders.

## 3. Database (once, Tom)

Apply `supabase/migrations/036_analytics_snapshots.sql` in the Supabase SQL
editor (it checks that 030 is applied, and runs a self-check). Until then the
dashboards show "not connected yet" and the job only logs write errors.

## Automatic setup — "Connect Google" (recommended)

Admin → the project → **Google** card. Sections 4 and 5 below become the
fallback for properties the client owns themselves; for sites Abluo hosts,
the service account creates and connects everything — nobody clicks in Google.

### Once (Tom)

1. **Google Cloud → APIs & Services → Library** (same project as step 1), enable also:
   - **Google Site Verification API**
   - **Google Analytics Admin API**
   (Data API and Search Console API from step 1.2 stay on.)
2. **Google Analytics** → Admin → the Abluo **account** (not a property) →
   **Account access management** → add the service-account email as **Editor**.
   Note the **Account ID** (Admin → Account details, a number like `123456789`).
3. **Vercel env vars** (Production, plus Preview/Development to test there), then redeploy:

   | Name | Value |
   |---|---|
   | `GOOGLE_ANALYTICS_ACCOUNT_ID` | the GA account ID (`123456789`; `accounts/123456789` also works). Needed only to create or find a property. |
   | `GOOGLE_SEARCH_CONSOLE_OWNERS` | comma-separated Google accounts to add as verified owners of every connected Search Console property, e.g. `thomas@tmz.it`. Optional: without it only the service account owns the property (you would not see it in your own Search Console). |

   Missing values are reported on the card ("not configured"), never guessed.

### Per site

Prerequisite for Search Console: the site is **live on its custom domain,
served by Abluo** (Supabase `projects.custom_domain` set, routing generated and
deployed, DNS pointing at Vercel). Analytics can run as soon as the domain is set.

Click **Set up both** (or each one). It is safe to click again at any time —
every step checks first and only adds what is missing.

**Analytics** (`src/lib/google/analytics-setup.ts`)
1. The project's google-analytics integration already has a measurement ID and a
   property ID → nothing is created; the entry is switched on.
2. Neither → a GA4 property `<project name> (<domain>)` (time zone Europe/Rome,
   currency EUR) is created under `GOOGLE_ANALYTICS_ACCOUNT_ID` — or found by that
   name on a re-run — and a web stream for the site URL (reused if it exists).
3. Measurement ID only → the property whose web stream has it is found in the account.
4. Studio's google-analytics entry is written: **enabled**, measurement ID + property ID.
   Enabling it turns on the GA tag, and with it the cookie banner's Analytics
   category (ADR-021) — expected.

**Search Console** (`src/lib/google/search-console-setup.ts`)
1. Property = `https://` + the host the domain ends on after redirects (at most 3) + `/`,
   e.g. `example.com` → `https://www.example.com/` (a URL-prefix property).
2. Site Verification API → a META token, written to **Website Settings → SEO →
   Google Site Verification** (`siteConfig.googleSiteVerification`) on the published
   document — and on Studio's open draft, if there is one, so publishing that draft
   cannot undo it. No draft is ever created.
3. The live homepage is polled (≈90 s, every 7.5 s) until it shows the tag. If it
   does not, the card says **Waiting for site** — the site is not served by Abluo
   on that domain yet (or a cache still serves the old page). Click again later.
4. Verified → the service account is a verified owner; the owners from
   `GOOGLE_SEARCH_CONSOLE_OWNERS` are added (the service account stays).
5. The property is added to Search Console, and Studio's google-search-console
   entry is written: **enabled**, `siteUrl`.

Afterwards the site's analytics refresh runs once (a brand-new GA4 property has
no data until visitors arrive; Search Console data lags 2–3 days). Each run is
written to the admin audit log (`google.analytics.setup`,
`google.search_console.connect`, with the outcome).

**Card states:** Connected · Not set up · Waiting for site (Search Console: the
token is on the site settings but the property is not connected yet) · Error
(with Google's message). Common errors:

| Message | Fix |
|---|---|
| Give `<SA email>` Editor access to Analytics account `<id>` | Once-step 2 |
| A Google API is switched off … | Once-step 1 (enable the named API) |
| GOOGLE_ANALYTICS_ACCOUNT_ID is not set | Once-step 3 |
| Add the site's domain first | set `custom_domain` (wizard → "Add the domain") |

**Limit:** Search Console can only be connected for a site Abluo serves on its own
domain (the tag must be on the live page). A Domain property (`sc-domain:…`,
DNS verification) stays manual — enter it in Studio as in section 5.

## 4. Each client (once per site) — manual fallback

Send the client the service-account email and ask them to:

**Google Analytics 4**
1. analytics.google.com → **Admin** (gear) → the right **property** → **Property access management**.
2. **+ → Add users**, paste the service-account email, role **Viewer**, uncheck "Notify", **Add**.
3. Tell you the **Property ID**: Admin → **Property details** (a number like `412345678`;
   *not* the `G-…` measurement ID).

**Search Console**
1. search.google.com/search-console → the right property → **Settings → Users and permissions**.
2. **Add user**, paste the service-account email, permission **Restricted** (read-only), **Add**.
3. Note the property name exactly as shown: either `sc-domain:example.com` (Domain property)
   or the full URL-prefix, ending in `/` (`https://www.example.com/`).

If you manage the client's Google properties yourself, you do these steps.

## 5. Studio: enter the IDs (Abluo admin)

Studio → the project → **Project Settings → Integrations**:

- **Google Analytics (GA4)** → **GA4 property ID (reporting)** = the numeric property ID.
  Read whether or not the integration's "enabled" switch is on: that switch only
  controls the website tag (a site may load GA4 through GTM and still want numbers).
- **Google Search Console** → **Search Console property** = `sc-domain:…` or `https://…/`,
  and switch it **on**. It renders nothing on the website and adds nothing to the
  cookie banner; it only tells the job which property to read.

Publish the project document. Clients never see these settings.

## 6. First refresh

Either wait for the next run (daily at 04:30 UTC, `vercel.json`), or:

- admin → **Analytics** → the site → **Refresh now** (runs the same job for that
  one site immediately), or
- call the job by hand (all sites):
  `curl -H "Authorization: Bearer $CRON_SECRET" https://abluo.app/api/cron/analytics`
  — the JSON response lists `projects`, `withData`, `notConnected` and `errors` per site.

## 7. Reading the status and errors

Admin → **Analytics** shows one row per live/preview site with a data status:

| Status | Meaning | What to do |
|---|---|---|
| Connected | The latest snapshot is good and at most 2 days old | — |
| Stale | The latest good snapshot is more than 2 days old (a run or two missed) | Usually fixes itself; if not, check the cron in Vercel → Cron Jobs / logs |
| Out of date | The latest good snapshot is more than 7 days old (the job has stopped producing data for this site) | Check the cron logs, then Refresh now |
| Not connected | No source's latest snapshot is good: no property ID / site URL in Studio, never fetched, or the IDs were removed | Step 5, then Refresh now |
| Error | Google refused the latest call for a source (wins over the others) | Open the site: the error box shows Google's message |

Old good numbers keep showing for a Stale or Out of date site; the status says
how old they are. The rule is `dataStatusOf()` in `src/lib/analytics/view.ts`
(thresholds `STALE_AFTER_MS` / `OUT_OF_DATE_AFTER_MS` in `periods.ts`). The
portfolio reads the last week of snapshots for every site and, for a site with
no good snapshot in that week, its latest rows whatever their age — so an old
site reads Out of date, never Not connected.

Common messages (shown on the site page, also in the cron logs):

- `GA4 403 PERMISSION_DENIED: User does not have sufficient permissions for this property` —
  the client has not added the service account as Viewer on **this** property, or the property ID is wrong.
- `Search Console 403 …` — service account not added to the Search Console property, or the
  property name differs (`sc-domain:` vs `https://…/`, `www` vs no `www`, trailing `/`).
- `Google service account not configured …` — env vars missing on this deployment (step 2).
- `Google token exchange failed (400): Invalid JWT Signature` — the private key was pasted wrong
  (missing BEGIN/END lines or broken line breaks) or the key was deleted in Google Cloud.
- `… has not been used in project … or it is disabled` — enable the API (step 1.2).

When the last snapshot is an error, the dashboards keep showing the last good
numbers (the client page says when it was last updated).

## Where the code is

| Piece | Path |
|---|---|
| Service-account JWT + token cache (per scope set) | `src/lib/analytics/google-auth.ts` |
| Connect Google (setup) | `src/lib/google/*`, `src/lib/admin/google.ts`, `google-actions.ts`, `src/components/admin/projects/GoogleCard.tsx` |
| GA4 / Search Console adapters (pure mappers) | `src/lib/analytics/ga4.ts`, `gsc.ts` |
| Studio IDs → config | `src/lib/analytics/config.ts` |
| Snapshot job | `src/lib/analytics/snapshot.ts`, `src/app/api/cron/analytics/route.ts` |
| Client read (permission + RLS) | `src/lib/analytics/read.ts` |
| Admin reads, audit, Refresh now | `src/lib/admin/analytics.ts`, `analytics-actions.ts` |
| Widgets (shared client + admin) | `src/components/app/analytics/AnalyticsOverview.tsx` |
| Table | `supabase/migrations/036_analytics_snapshots.sql` |
