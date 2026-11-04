# ADR-046 — Lottie animations in the Media Library

**Status:** Accepted (slice 1 built). Decisions by Tom on 2026-11-03.
**Date:** 2026-11-03
**Owner:** Tom
**Relates:** ADR-022 (Gallery, focal points), ADR-030 (admin Media), ADR-035 (media processing pipeline), ADR-021 (consent — no third-party loads), standing rule "every image is a Media Library asset before it is used"

---

## Context

Sites want small animations: the Freeriders rider pedalling across its skyline (a Lottie file today, played by Webflow), and platform-wide confirmations such as a "message sent" checkmark. Lottie is the open vector-animation format (Lottie Animation Community specification 1.0; IANA `video/lottie+json`); `.lottie` (dotLottie) is its packaged, smaller form. The Media Library only knew images (and legacy video URLs), and every image list assumes `defined(image.asset)`.

## Decisions

### D1 — An animation is a `mediaAsset` with `mediaType: 'animation'`
- New `mediaType` option `animation`, a `file` field **`animation`** (the binary, a Sanity *file* asset) and a read-only **`animationInfo`** (`format` `lottie-json` | `dotlottie`, `width`, `height`, `frameRate`, `frames` — known for plain JSON only).
- **No `image` field.** Every existing image list, picker and website query filters `defined(image.asset)`, so animations never appear where a photo is expected. The by-id checks that store a Media Library id (gallery items, person photo, catalogue media) now also require `defined(image.asset)`, so a crafted request cannot place an animation there.
- Additive schema change: no existing document changes shape, no migration.

### D2 — Only the Abluo admin uploads animations
- Animations are a design decision (Tom, 2026-11-03). `uploadProjectAnimation` (post-media.ts) is called only by the admin action `uploadAdminAnimationAction`; no client action calls it.
- The admin Media screen lists animations (`listProjectMedia({ animations: true })`); the client Media screen and every picker do not (slice 2 may show them to tenants read-only).
- The upload checks the file's **own bytes** (`readLottie`, `src/lib/media/lottie.ts`): plain Lottie JSON (version, frame rate, in/out points, size, `layers`) or a `.lottie` ZIP (manifest + `animations/`). Declared type and extension are ignored. ≤ 2 MB. Same project lookup and per-user rate limit as images. Stored as received — no Tinify.

### D3 — One player: dotLottie web, self-hosted
- `AnimationPreview` (`src/components/app/ui`, Component Lab) is the only Lottie player in the dashboards: still frame + play on hover (tiles, table) or loop (photo panel), loads near the screen, freezes off screen, reduced motion → still.
- Player: `@lottiefiles/dotlottie-web` (MIT), pinned exactly. Its WebAssembly file is served from `/vendor/dotlottie/<version>/` (never a CDN — no third-party request, nothing for the consent banner). A test fails when the pinned version, the installed package and the served file disagree. `proxy.ts` passes `.wasm` through like other static files.

### D4 — Platform animations ship with the code and take the site's colours
- A small curated set lives in `src/lib/animations/` (`PLATFORM_ANIMATIONS`), each with source and licence recorded. First: `checkmark` (Abluo original), one colour slot `accent`.
- Colours are Lottie **slots**, set when played from the site's design system (`hexToLottieColor` → `setColorSlot`), never baked into copies of the file.
- An animation made for one client (the Freeriders rider) is not a platform animation: it lives in that project's Media Library.

### D5 — Motion on the website stays in components
- Architectural principle 3 holds: Sanity stores *which* animation, never timing or easing. Movement across a section (e.g. the rider crossing the skyline) is a future component (with a new motion primitive), designed separately.

## Not in slice 1
- Website rendering of animations (a section/decoration component and the crossing motion).
- Tenants seeing animations in their Media screen; platform animations in forms (the "sent" state).
- Unpacking `.lottie` archives to read their size/length.

## Consequences
- New dependency (~1.2 MB WebAssembly, loaded only when an animation is shown).
- Deleting an animation works like a photo (refused while referenced).
