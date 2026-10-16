# Client dashboard — guided content creation (spec)

Authority: ADR-025. This doc is the *what it looks like*. Verification lives in `verification.md`, next to this file.

**Principle:** Tap → tap → write → preview → publish. Ask only what's needed, default the rest. The user can never lose work.

## Dashboard UX rules (every module, wizard and editor)
Decided by Tom on 2026-10-16. These rules apply to Posts, Catalogue, Events, Galleries, Media and any new module. The Catalogue plan that applies them is in the Abluo project doc `claude/catalogue-ux-redesign-proposal-2026-10-16.md` (§2.0).
1. **A disabled primary action says why.** Next, Create, Publish, Apply and the like never sit greyed out silently. Name what is missing or invalid, next to the button.
2. **Drafts are never blocked.** An incomplete draft always autosaves. Optional fields never block Next. Only the minimum the item needs in order to exist is required to continue.
3. **Publication blockers are listed with links.** When Publish is not possible, list every missing or invalid field by name and, where possible, link straight to the step or tab that fixes it. The check happens on publish, never on save (ADR-032).
4. **Create without leaving.** Things an item depends on (e.g. a category, later a tag) can be created inline, without leaving the current workflow. Inline creation uses the same data, permissions and project scope as the full management screen. There is no second way to write.
5. **Choices explain their consequences.** A choice card says what picking it means, with examples (e.g. "Book — author, cover, ISBN, buying links").
6. **One save model.** Autosave everywhere: "Saving…" until the server confirms, then "Saved". No editor with an explicit Save button beside autosaving ones.

## Screen anatomy (every wizard step)
```
┌───────────────────────────────┐
│ [Save & exit]      [● Saved]  │  top: exit + save pill (no Save button)
│                               │
│ Question as H1 (one line-ish) │  one decision per screen
│ Helper text, muted            │
│                               │
│ Big cards / chips / fields    │  min 44px targets, 2-col grid on phone
│                               │
├───────────────────────────────┤
│ ▬▬▬▬▬▬░░░░░░░░░ progress      │  segmented progress (one segment per group)
│ Back                  [Next]  │  sticky bottom, thumb zone, safe-area
└───────────────────────────────┘
```
- **Desktop (≥ 1024px):** the same column, centred, max-width ~640px. Keyboard: Enter = Next, Esc = Save & exit.
- **Selected card:** 2px foreground border plus a muted fill (the Airbnb pattern). This works in both themes because it is token-driven.
- **No dropdowns in the wizard.** Use cards, chips, toggles, steppers or date-time chips.
- **Motion:** step transitions use `durationBase` / `easingStandard`. Respect `prefers-reduced-motion`.

## Steps (Blog)
| # | Question | Controls | Saved to | Skippable |
|---|---|---|---|---|
| 1 | What would you like to create? | type cards from installed modules | creates `drafts.<id>` | auto-skipped if only 1 type |
| 2 | What's this post about? | category chips (multi) from module config | `categories[]` (keys) | yes, if no categories are configured |
| 3 | Give your story a title | Title, Subtitle (optional), ✨ Improve title (S9) | `title[loc]`, `subtitle[loc]` | Title required |
| 4 | Tell your story | Write · Paste · 🎙 Dictate (S9) · ✨ Write with AI (S9) | `body[loc]` | — |
| 5 | Add a cover image | Take photo · From device · Media Library · ✨ Generate (later) · Skip | Media Library asset → `coverImage` | yes |
| 6 | Make it available in other languages? | one row per site locale: Original / Translate / Later | `translationStatus: machine` | only shown when the site has more than one locale |
| 7 | Here's how your post will look | real tenant render in a frame, Edit links per block | — | — |
| 8 | What do you want to do with it? | Publish now · Schedule (date+time chips) · Keep as draft; advanced: Take offline automatically | `publishedAt`, `expiresAt`, publish | — |
| 9 | Give it more visibility? | visual placement previews (S10) | `promotion.*` | yes |
| ✓ | Published | View on site · Share link · Back to dashboard | — | — |

The locale for step 3 onward is the site's default locale. The user's interface locale is separate (Content ≠ Interface localization).

## Defaults (never asked in the wizard)
Author = current user · slug = from title, per locale, unique per project · publishedAt = now · excerpt ← subtitle · SEO title ← title · SEO description ← excerpt/subtitle · social image ← cover.

## Dashboard home (S1)
- **Phone:** bottom tab bar with Home · Content · Leads · More, plus a floating **+ Add content** button.
- **Desktop:** sidebar.
- Home cards: *Continue editing* (drafts with their step), *Recent posts*, *New leads*, *View your site*.

## Direct editor (S7)
After the first publish, a post opens in a tabbed editor instead of the wizard: Content · Media · Categories & tags · Languages · SEO & social · Publishing · Promotion. It uses the same autosave engine.

## Copy
Every string lives in `messages/{en,it,de}.json` under `editor.*` and `clientDashboard.*`. Tone: warm, short, second person, no CMS words (no "document", "field", "slug" or "publish date" in the main flow).
