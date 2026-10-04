# Client dashboard — verification (read by /verify)

Any change under `src/app/[locale]/(client)/`, `src/components/client/`, `src/lib/api/client-*`, the `post` schema or blog website queries **must** pass this before it is reported done. Report each item as ✅ / ❌ / ⏭ (with a reason). Never advance a slice on ❌.

## 1. Gates (always)
```bash
npx tsc --noEmit
npx vitest run
npm run build
npm run verify:dashboard        # Playwright matrix + axe (S0 adds it)
```
Then run `git checkout -- next-env.d.ts` if the build touched it.

## 2. Automated checks (the harness lives in `e2e/client/` + `src/**/__tests__`)
| ID | Check | How |
|---|---|---|
| T1 | Token contrast: every fg/bg semantic pair ≥ 4.5:1 (text) / 3:1 (borders, focus) in **light and dark** | vitest, oklch → sRGB from `globals.css` |
| T2 | No raw colours in client code (`zinc-`, `gray-`, `slate-`, `neutral-`, `bg-white`, `text-black`, `#hex`, `rgb(`) | vitest source scan |
| T3 | No `<select>` / `Select` in `src/components/client/wizard/**` | vitest source scan |
| T4 | i18n parity: `editor.*` + `clientDashboard.*` keys identical in en/it/de, none empty | vitest |
| T5 | No hardcoded user-facing text in client components (JSX text nodes / aria-label literals) | vitest source scan, allowlist for symbols |
| E1 | Each flow runs in 4 projects: `phone-light` 390×844, `phone-dark`, `desktop-light` 1280×800, `desktop-dark` | Playwright `colorScheme` |
| E2 | axe: 0 serious/critical violations on every wizard step and dashboard page, every project | `@axe-core/playwright` |
| E3 | Tap targets ≥ 44×44 on phone; Back/Next visible without scrolling; respects `env(safe-area-inset-bottom)` | Playwright bounding boxes |
| E4 | Autosave: type title → reload → title **and step** restored | Playwright |
| E5 | Offline: `setOffline(true)` → type → pill says offline → online → server has the text | Playwright |
| E6 | Close mid-typing (`page.close()` < 800 ms after keystroke) → reopen → text present | Playwright |
| E7 | Two tabs edit the same draft → second save shows "edited elsewhere", no silent overwrite | Playwright |
| E8 | Theme: Auto follows `colorScheme`; manual choice persists across reload with no flash of the wrong theme | Playwright |
| S1 | Every new write route is classified in `route-auth-matrix.test.ts` | vitest |
| S2 | Viewer role → write refused; project A grant → patch on project B doc refused; module not installed → 404 | vitest (data layer) + Playwright |
| W1 | Drafts never on the public site; a future `publishedAt` is hidden; a past `unpublishAt` is hidden (list, detail, sitemap) | vitest on queries + live probe |
| W2 | Machine translation never overwrites `original`/`reviewed` | vitest (ADR-023 tests extended) |

## 3. Visual review (the /verify agent does this by looking)
Screenshot every wizard step plus the dashboard home in all 4 projects. Check against:
- [ ] One question per screen, as the H1. Nothing technical visible (no "slug", "document", ids, JSON).
- [ ] Choices are big cards/chips. The selected state is obvious in **both** themes.
- [ ] Progress bar is visible. Back/Next are in the thumb zone. Save pill is present, with no Save button.
- [ ] Dark mode: no white flashes, no invisible borders, images not washed out, focus ring visible.
- [ ] Preview shows the real tenant design (cover, title, subtitle, category · author · date, body).
- [ ] Copy is warm and short, and matches the dashboard UI language.
- [ ] It feels calm: generous spacing, ≤ 2 type weights per screen, no visual noise.

## 4. Test data
- Account: the test owner of project `abluo` (see the client-dashboard handoff). Blog is installed on `abluo` for this track.
- Run against `localhost:3000` for E-checks. The live probe (W1) runs against `dev.abluo.app` after push.
- E-tests create drafts with title prefix `[e2e]` and delete them in teardown. They never publish to a real tenant except `abluo`.
