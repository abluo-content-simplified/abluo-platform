# Analytics setup — Google Analytics 4 + Search Console

ADR-029 §3.4 (client dashboard) and ADR-030 §5.2 (admin). How the numbers get
from Google into the dashboards, and what Tom and each client have to do once.

```
Studio (property IDs) ─┐
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

## 4. Each client (once per site)

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
| Service-account JWT + token cache | `src/lib/analytics/google-auth.ts` |
| GA4 / Search Console adapters (pure mappers) | `src/lib/analytics/ga4.ts`, `gsc.ts` |
| Studio IDs → config | `src/lib/analytics/config.ts` |
| Snapshot job | `src/lib/analytics/snapshot.ts`, `src/app/api/cron/analytics/route.ts` |
| Client read (permission + RLS) | `src/lib/analytics/read.ts` |
| Admin reads, audit, Refresh now | `src/lib/admin/analytics.ts`, `analytics-actions.ts` |
| Widgets (shared client + admin) | `src/components/app/analytics/AnalyticsOverview.tsx` |
| Table | `supabase/migrations/036_analytics_snapshots.sql` |
