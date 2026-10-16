# ADR-035 — Media processing pipeline (non-blocking uploads)

**Status:** Accepted — Tom, 2026-10-16. Slice 1 committed on dev (`a12f34d`); slice 2 built on dev 2026-10-16.
**Touches:** `src/lib/media/*`, `src/lib/client/gallery-upload-queue.ts`, `src/lib/client/upload-plan.ts`, `src/components/client/media/AddPhotos.tsx`, `src/lib/api/post-media.ts`, `mediaAsset` schema, blog Cover step.
**Related:** ADR-022 (Gallery module — focal points live on the Media Library asset), standing rule "every image is a Media Library asset before use", standing rule "all images go through TinyPNG".

## Context

Uploading photos feels slow and blocks the person. Today every photo makes one
request that does everything in sequence (`createMediaAsset`):

1. Browser: re-encode to 2560 px / JPEG q0.92 **only** when the file is over 3.8 MB or 2560 px (`planUpload`).
2. Server: send the bytes to Tinify, wait, download the result (a second, paid call if it still needs resizing).
3. Server: upload to Sanity, then create the `mediaAsset` document.
4. Browser: only now does the photo exist — only now can the person add alt text, a name, a focal point.

The queue runs 2 at a time. The "Compressing…" label is a timer guess, not real progress.

### What the person is actually doing

On a phone, Add Photos (and the blog Cover step) offers **Take a photo · From this phone · Media Library**.
A typical post: take or pick a photo, then spend 20–60 s writing alt text, a
description and placing the focal point. That human time is far longer than the
processing time — so processing that runs *while they type* is invisible.
The goal of this ADR is to make it run then, instead of before.

### Measurements (2026-10-15)

PERF-1 timing logs (`[perf] … media.optimize / sanity.assetUpload`) were the
intended source, but the Vercel plan keeps runtime logs for **1 hour** and none
covered an upload. So the Tinify step was measured directly with the production
API key from Tom's Mac (uplink ≈ 0.48 MB/s ≈ 4 Mbps). Test images: four real
photographs at iPhone size, 4032 × 3024, JPEG q92 with sensor-like noise,
2.4–3.0 MB each. 12 Tinify credits spent; nothing written to Sanity.

| | Today's path: browser → 2560 px q0.92, then Tinify | Untouched 12 MP original → Tinify shrink + resize |
|---|---|---|
| Bytes sent to Tinify | 0.72–1.15 MB | 2.4–3.0 MB |
| Tinify shrink call (incl. upload) | **3.7–4.8 s** | 11.0–19.4 s |
| Download / resize call | 0.3 s | 7.2–11.1 s |
| **Total Tinify time** | **≈ 4–5 s** | **≈ 19–30 s** |
| Tinify credits | 1 | 2 |
| Final file | 148–376 KB | 143–346 KB (4–9 % smaller) |
| Browser re-encode (PIL on a Mac as stand-in) | 0.15–0.18 s | — |

Subtracting upload time (≈ 2 s for 1.1 MB, ≈ 6 s for 3 MB at this uplink), Tinify's own
processing is **≈ 2.5–3 s for a 2560 px photo and ≈ 13–24 s for a 12 MP one**.
From Vercel (dub1) the upload part shrinks, the processing part doesn't.

Not measured (estimates, to verify on dev with `PERF_TIMING=1` immediately after an upload):
the phone's own upload to Vercel (≈ 2 s for 1 MB on decent 4G, 10–30 s on weak signal),
Sanity asset upload from dub1 (≈ 0.5–1 s), canvas re-encode on a phone (≈ 0.3–1.5 s).

**Today, per photo:** phone upload ≈ 2 s + Tinify ≈ 3–3.5 s + Sanity ≈ 1 s ≈ **6–7 s before the
photo can be touched; about half of it is Tinify.** Six photos at concurrency 2 ≈ 20 s of waiting.

**Findings that changed the plan:**

- Sending the untouched original to Tinify (the motivation for a Supabase staging bucket) is
  **4–6× slower, costs double, and saves only 4–9 %**. The browser's high-quality 2560 px
  re-encode is what makes Tinify fast; it stays — as the standard first step, not a fallback.
- Every website image is served through Sanity's image service (`imageUrl` / `imageSrcSet`:
  width-capped, q80, WebP/AVIF). Visitors receive Sanity's re-encode, not the stored file.
  So **an image is publishable as soon as the prepared file is in Sanity** — Tinify reduces
  storage and original-file size, it is not needed for the page to be correct.

## Options evaluated

### 1. Intelligent processing in the browser

Decide and resize on the device; send the prepared file.

- **+** Already built (`planUpload`, `prepareForUpload`). Keeps every upload under Vercel's 4.5 MB request limit. Makes Tinify 4–6× faster.
- **−** Canvas can't do Tinify-grade compression; HEIC and colour profiles depend on the browser (iOS Safari hands over JPEG for camera/library picks). Costs the phone a second or so.
- **Cost:** none new — extend `planUpload` with the policy below.
- **Verdict:** keep, as step one of every path.

### 2. Supabase staging bucket + background optimisation

Upload originals to a private bucket via signed URL; a job optimises and moves them to Sanity.

- **+** Upload survives the browser closing once it has finished. Nothing enters Sanity until final, so no file swap.
- **−** Its main promised benefit (optimise the untouched original) measured as slow and nearly worthless. Two extra transfers (bucket → function → Sanity). Needs a bucket + RLS, a jobs table, a cron sweeper, retention and cleanup — about 3–4 days of build plus a permanent moving part.
- **Verdict:** **not now.** Revisit only if we need originals kept for later re-processing, or uploads above what the browser can prepare (e.g. video).

### 3. Straight to Sanity, Tinify in the background

Send the prepared file to the server; answer immediately; optimise afterwards.

- **+** Fastest to usable. No new infrastructure: the bytes are already in the function's memory, so Next's `after()` can optimise them after the response is sent.
- **−** If Tinify finishes *after* the file is in Sanity, the file must be swapped (Sanity assets are immutable), and blog covers copy the file reference (`coverImage.asset._ref`), so a swap must repoint them.
- **Verdict:** yes, with one change that removes the swap — see Decision.

## Decision — hybrid of 1 and 3, no staging bucket

```
pick / take photo
  → instant local preview (object URL)
  → reserve: tiny request creates the mediaAsset { status: 'uploading', name } → id
  → browser prepares (policy, resize ≤ 2560 q0.92 when needed)
  → upload prepared file → server sets status 'processing', responds at once
       after():  policy says optimise → Tinify (≈ 3 s) → on failure keep the prepared bytes
                 → Sanity asset upload → patch mediaAsset.image + stats + status 'ready'
  → person edits name / alt / focal point the whole time (saved on the reserved record)
```

**The file goes into Sanity once, already final** — Tinify runs in `after()` *before* the Sanity
upload, not after it. No swap, no reference repointing, no orphaned originals. Typical time from
upload finished to Ready: ≈ 4–5 s, inside the time the person spends writing alt text.

### Processing policy (`src/lib/media/processing-policy.ts`)

Decides `keep` or `optimize` per image. Resizing stays the browser's job
(`planUpload`), so the server only decides compression. Inputs come from the
file's own header (`src/lib/media/image-info.ts`: format, pixel size, animation),
never from the browser. Platform constants, never shown to users, never per tenant.

| Decision | When (as built — to tune with real uploads) |
|---|---|
| `keep · animated` | APNG or animated WebP — never re-encoded |
| `keep · small` | ≤ 150 KB (the Amazon cover) |
| `keep · modern_format` | WebP ≤ 1 MB |
| `keep · already_compressed` | ≤ 0.08 bytes per pixel (Tinify's own output lands at 0.03–0.08) |
| `optimize · heavy` | above that — e.g. the browser's q0.92 re-encode (0.15–0.23 B/px) or a camera JPEG |
| `keep / optimize · unknown_size` | header unreadable: keep ≤ 500 KB, else optimise |

The bytes-per-pixel rule replaces the fixed "≤ 2560 px and ≤ 500 KB" idea: a
450 KB image is kept when it's large and already compressed, optimised when
it's small and heavy. SVG stays out of scope (needs sanitising — its own ADR).
Skipped images save a Tinify credit and ≈ 3 s.

### Status model (`mediaAsset.processing`)

`uploading → processing → ready | failed`, plus `stats { originalBytes, finalBytes, width, height, optimized, reason }`
shown in the Media Library ("2.9 MB → 330 KB · 89 %" / "Optimisation not required").
`failed` keeps the record and its metadata; Retry re-sends from the tab if the file is still in memory,
otherwise asks for the photo again. Website queries never project `processing` (same rule as `translationStatus`).

### Editing before Ready

- Name and alt text are saved on the reserved record immediately. The focal point is chosen on the
  local preview and stored as x/y (0–1) in `processing.pendingFocal` (the image object, where
  `hotspot` normally lives, doesn't exist yet); the Ready step writes it into `image.hotspot`.
  Aspect ratio is never altered and nothing is cropped, so the coordinates apply unchanged.
- A still-processing photo can be **chosen** as a cover or gallery item. Galleries reference the
  `mediaAsset` and just work. For blog covers (which store the file reference), the wizard keeps
  `wizard.pendingCover = mediaAssetId` and writes `coverImage` when the asset turns Ready.

### Publishing

Publish never fails because of a photo. If an image is still processing, the button shows
**"Finishing your photo…"** and publishes as soon as it's Ready (typically seconds).
Server guard: the publish action refuses while `wizard.pendingCover` is set or any referenced
`mediaAsset` is not `ready`. All strings localized (`clientDashboard.media.*`).

### Reliability

- The upload queue moves from `AddPhotos` to a provider in the dashboard layout, so leaving the
  screen doesn't stop uploads. Closing the tab still does — but the record and metadata survive,
  and the row shows "Upload interrupted — add the photo again".
- A cron sweep marks records stuck in `uploading` > 1 h / `processing` > 10 min as `failed`.
- Concurrency: 3 uploads at once (Tinify load is bounded by the same number).
- `after()` runs inside the function's `maxDuration`; Tinify ≈ 3 s + Sanity ≈ 1 s is well inside it. Verify the media action's duration limit on the current Vercel plan.

## Consequences

- **Good:** photos are editable within a second of being picked; Ready a few seconds after the upload ends; no new infrastructure; one Sanity write per photo; fewer Tinify credits.
- **Accepted:** no original kept beyond the 2560 px prepared file (same as today). Closing the tab mid-upload loses the bytes, not the metadata.
- **Schema:** `mediaAsset.image`'s custom validation (schema.ts, currently requires an image for `mediaType: image`) allows a missing image while `processing.status` ≠ `ready`; existing documents have no `processing` field and are treated as `ready` — no migration needed (checked shape before deploy per Schema Evolution rules).
- **Deferred:** covers referencing `mediaAsset` instead of the file (removes `pendingCover`); SVG; real byte-level upload progress (needs a route handler instead of a server action); completion sound/haptic.

## Slices

1. **Done (2026-10-16, uncommitted on dev).**
   - Policy + header reader, with tests.
   - `mediaAsset.processing` (status, times, optimised, reason, bytes) — schema field, read-only; the image validation allows a missing image while `processing`/`failed`.
   - Upload actions take `background=1`: the record is created once the bytes are checked (type, size, rate limit, project), the action answers, and `after()` runs policy → Tinify → Sanity upload → `ready` (or `failed`). Cover step and other callers without the flag keep the one-call path, now also with the policy.
   - `get…MediaStatus` actions (gallery, media, admin) for polling.
   - One shared queue hook (`useMediaUploads`) and row list (`UploadQueueList`) replace the two copies in Add Photos and the gallery wizard: local previews, real Uploading → Optimising → Ready states (the timer guess is gone), 3 sends at once, at most 4 waiting on the server, give up after 2 min.
   - Background work logs its own `[perf] media.process` line.
   - **Not in slice 1:** the record is created when the upload arrives, not when the photo is picked — pick-time reservation only matters once metadata can be edited before upload (slice 2).
2. **Built (2026-10-16).**
   - **One upload store per dashboard** (`src/lib/client/upload-store.ts`, mounted by `UploadsProvider` in the client and admin layouts). Uploads continue when the person changes screen; the layout says "Finishing N photos…" and then "N photos added to your Media Library" for photos whose screen is gone, and warns before the tab is closed while bytes are still only in the browser.
   - **Owners:** each screen that adds photos subscribes as an owner. A long-lived parent (the Catalogue item wizard/editor) registers as the *fallback* owner (`useUploadOwner`), so a photo that finishes after the person moved to the next step or tab still joins the item. Primary and fallback never both receive a photo.
   - **Publish waits:** the Catalogue wizard and editor hold Publish while the item's photos are on their way, and the button says so ("Finishing 1 photo…").
   - **Blog cover — edit before Ready:** the new photo shows at once from a local preview; its description and focus point can be written while it uploads and is optimised; both are written with the cover once it is ready. The step holds Next/Back meanwhile (label "Finishing your photo…") — chosen over a hand-off to the wizard shell because it keeps the cover step's single save chain; in practice the hold is invisible (the person is typing the description).
   - **Daily sweep** (`/api/cron/media-sweep`, 05:45 UTC): `processing` for over an hour → `failed`; `failed` placeholders older than a week, with no image and no references, deleted.
   - **Changed from the plan:** no pick-time reservation and no `pendingFocal` on the record. The browser holds the description/focus point until the record is ready (cover) or the photo card opens on a ready photo (Media Library, galleries, Catalogue). `wizard.pendingCover` is not needed because the cover step waits. Revisit if editing a gallery's photos before they are ready turns out to matter.
   - **Also in this round (Catalogue quick wins):** 2.3 the shared publishing component (`app/lifecycle/PublishChoice`, Posts + Catalogue — Schedule expands in place with Publish on and an optional Unpublish on) and 2.5 the shared photo source (`PhotoSource`: take / upload / Media Library) plus the photo card by id (`PhotoEditSheet`: description and focus point) in the Catalogue item.
3. Media Library stats display; measure on dev with `PERF_TIMING=1` and tune thresholds.
