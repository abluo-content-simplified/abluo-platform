# Google Maps keys

Abluo uses two Google Maps keys. Both are public (they end up in the browser),
so each one is locked down by **API restriction** and, for the Studio key, by
**HTTP referrer**. Neither is ever stored in Sanity.

| Env var | Used by | Google APIs | Cost |
|---|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Website maps — Contact section map, Locations section maps (`src/lib/maps/provider.ts`) | **Maps Embed API** only | Free, unlimited |
| `NEXT_PUBLIC_GOOGLE_MAPS_STUDIO_KEY` | Studio entrance-pin picker on *Website Settings → Contact → Locations → Entrance pin* (`src/lib/sanity/fields/LocationPinInput.tsx`) | **Maps JavaScript API**, **Places API**, **Maps Static API** | Within Google's monthly free usage for a handful of editors |

The website key already existed for the Contact section map; the Locations
maps reuse it. If it is missing, every map degrades silently to the
"Open in Google Maps" link. If the Studio key is missing, the pin field shows
the plain latitude/longitude inputs.

Website maps are click-to-load behind cookie consent (ADR-021, embed vendor
`google-maps`): nothing is requested from Google until the visitor clicks
"Show map" or has chosen "Always allow Google Maps".

## Setup in Google Cloud Console

Project: the one that already holds the Abluo Maps key (a billing account must
be attached, even though the Embed API is free).

1. **APIs & Services → Library** — enable:
   - Maps Embed API
   - Maps JavaScript API
   - Places API — the classic one the map's search box uses
     (`places.Autocomplete`). Google no longer lets *new* projects enable the
     legacy Places API; if only "Places API (New)" is offered, enable that —
     the pin can still be placed by clicking/dragging even if the search box
     then fails.
   - Maps Static API (draws the small preview of the pin under the field)
2. **Website key** (`NEXT_PUBLIC_GOOGLE_MAPS_KEY`) — the existing key, or
   *Credentials → Create credentials → API key*:
   - *API restrictions → Restrict key →* **Maps Embed API** only.
   - *Application restrictions*: HTTP referrers are optional here (client
     domains change per tenant); the API restriction is what matters. If you
     add them, include every live client domain plus `*.abluo.app/*` and
     `localhost:3000/*`.
3. **Studio key** (`NEXT_PUBLIC_GOOGLE_MAPS_STUDIO_KEY`) — *Create credentials → API key*:
   - *API restrictions → Restrict key →* **Maps JavaScript API**, **Places API**, **Maps Static API**.
   - *Application restrictions → Websites (HTTP referrers)*:
     - `https://admin.abluo.app/*`
     - `https://dev.abluo.app/*`
     - `https://preview.abluo.app/*`
     - `http://localhost:3000/*`

## Where to set them

- **Vercel** → abluo-platform → Settings → Environment Variables: add both,
  ticked for **Production, Preview and Development**. They are `NEXT_PUBLIC_`,
  so they are baked in at build time — redeploy after adding or changing them.
- **Local**: `abluo-platform/.env.local` (one line each), then restart
  `npm run dev`.

The Studio is embedded in Next.js at `/studio`, so its variables need the
`NEXT_PUBLIC_` prefix — a `SANITY_STUDIO_` variable would not reach it.

## Studio picker notes

- Package: `@sanity/google-maps-input` **4.1.1**, pinned exactly. It is the
  last release for Sanity 3 on `@sanity/ui` 2 (4.2+ needs `@sanity/ui` 3,
  5.x needs Sanity 5). Revisit when the Studio moves to Sanity 4/5.
- It is wired on the one field (`siteLocation.pin`), not as a Studio plugin,
  so no other geopoint input changes.
- A new pin opens on Brussels; type the address in the map's search box, then
  drag the pin to the entrance. "Enter coordinates by hand" switches to the
  plain fields (useful if Google rejects the key).

## Audit 2026-10-20 (Events 2.0 Stage A)

These were checked by calling Google directly with the public website key, sending different `Referer` headers (one request per check).

| Website key (`NEXT_PUBLIC_GOOGLE_MAPS_KEY`, …FWUU) | Result |
|---|---|
| Referrer restriction | **On.** Allowed: abluo.app hosts (dev, preview, www, admin), localhost:3000, livener.net, studiomartegani.com |
| ameliez.com, noemizi.com, tmz.it | **Not allowed (403).** A map on those sites shows Google's error after consent |
| Maps Embed API | Works on allowed referrers ✅ |
| **Static Maps API** | **Enabled on this key, and it answers requests that send no referrer** — anyone holding the public key can use Static Maps on our billing (10,000 free per month, then $2 per 1,000) |
| Geocoding API | Refused ✅ |

**Code dependencies:** no Abluo code uses Static Maps or the Maps JavaScript API with this key (`src`, `public`, `scripts` and the client folders were searched). The Studio pin picker uses the *Studio* key. Restricting the website key to **Maps Embed API only** therefore breaks nothing in Abluo.

**Before restricting it (Tom):** in Google Cloud Console → APIs & Services → Metrics, filter by this key's credential and check Static Maps usage for the last 30 days. Any usage means something outside Abluo uses the key (an old Webflow site, for example) and must move first.

**Decision M1 (approved 2026-10-20, subject to that check):** API restriction = Maps Embed API only, and remove the per-domain referrer list (Embed is free and unlimited, so the list only adds a manual step per tenant domain).

**Studio key:** not verifiable from a Claude session (absent from `.env.local`, Vercel env list not readable). Check in Vercel → Settings → Environment Variables that `NEXT_PUBLIC_GOOGLE_MAPS_STUDIO_KEY` exists in Production, Preview and Development.

**Dashboard key (planned, ADR-038):** `NEXT_PUBLIC_GOOGLE_MAPS_DASHBOARD_KEY`.
- APIs: Maps JavaScript, Geocoding, Places (New).
- Referrers: `https://www.abluo.app/*`, `https://dev.abluo.app/*`, `https://preview.abluo.app/*`, `https://admin.abluo.app/*`, `http://localhost:3000/*`.
- Per-API daily quota caps plus a billing budget alert.
- Expected cost €0 (10,000 free requests per month per API at our volumes, Google price list 2026-10-20).
