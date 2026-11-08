# Abluo Help — brief (draft for Tom)

**Date:** 2026-11-08 · **Status:** proposal, nothing built · **Relates:** ADR-047 (search: the `?` prefix, Help group and Ask Abluo plug in here), ADR-042 (navigation), Component Lab rule

## Goal

Someone who updates their website twice a year opens a page, taps **?**, and in 30 seconds knows what the page is for and how to do the one thing they came to do. The same help is findable from search (`?event`) and, later, answers "Ask Abluo" questions.

## Principles

1. **Built module by module.** A module is "help-complete" when it has its articles; modules without help simply show no "?".
2. **Help lives with the code.** A screen change and its help change land in the same commit; a test fails when a module has screens but no help.
3. **Short.** One article = one task, 3–6 steps, no screenshots in v1 (they go stale). Videos only where a module is stable.
4. **Multilingual from day one.** English is written by us; Italian and German go through the same translation pipeline as the dashboard text, then you review.
5. **The UI first.** If an article needs more than 6 steps to explain something, that's a signal to fix the screen, not to write more help.

## Content model

Per module, in the repo next to the module (e.g. `src/lib/modules/<module>/help/`), one Markdown file per article and language:

```
help/
  overview.en.md        what this section is for (always)
  create-event.en.md    one task per file
  publish.en.md
  overview.it.md …
```

Frontmatter per article:

| Field | Example | Used for |
|---|---|---|
| `id` | `events.create` | links, search, analytics-free "was this helpful" later |
| `module` | `events` | only shown when the module is installed |
| `routes` | `/agenda`, `/agenda/[id]` | which page's "?" shows it first |
| `permission` | `events.event.write` | hidden from people who can't do it |
| `keywords` | calendar, appointment, date | search + synonyms |
| `video` | `events-create` (optional) | attaches a video when one exists |
| `updated` | 2026-11-08 | staleness check |

Platform pages (Media, Settings, Users, Billing, Search itself) get a `platform/` help folder the same way.

## Where people see it

- **"?" in each PageHeader** (right side) → SidePanel on desktop, BottomSheet on phone: the page's overview on top, then its task articles. Uses existing components (PageHeader, SidePanel, BottomSheet).
- **Search:** a **Help** group in results and the `?` prefix (`?private document`). Articles are indexed in the browser (they're small), so no extra server cost.
- **Account menu → Help** opens a Help home listing every installed module's articles.
- **Later:** "Ask Abluo" answers only from these articles, citing them (no client content sent to AI); guided "Show me how" steps reuse the article steps.

## Videos

Only for modules unlikely to change soon (decided per module, marked in the help folder).

1. **Recording:** a script drives a real browser on a demo site (Playwright, already in the toolchain) and records desktop and phone separately. When the screen changes, re-run the script; nobody re-films by hand.
2. **Language, cheapest first:**
   - **v1 — captions, no voice.** The script's step texts become translated captions. Near-zero cost per language.
   - **v2 — voiceover.** One English narration script → translated → text-to-speech per language (candidates to test: ElevenLabs, Google, OpenAI voices), timed to the scripted steps. Pick by testing the same 30-second clip in it/de/en.
3. **Length:** 20–45 seconds, one task each. **Hosting:** to decide (a video host vs. our storage); must not load third-party players without consent (ADR-021).

## Pilot (proposed order)

1. **Posts** — help articles only (overview, create, publish, add an image, schedule). Ship the "?" panel + Help in search with them.
2. Review with you; adjust tone and length.
3. One **captioned video** for "Create a post" (desktop + phone) to prove the recording script.
4. Then module by module: Events, Courses, Media, Contact Requests, Settings…

## Who writes

I draft each module's articles from the real screens (code + copy); you edit. Machine translation fills it/de; you or a reviewer check them like other dashboard text.

## Decisions for you

1. OK to keep help as files in the repo (vs. editable in Sanity without a deploy)? *Recommendation: repo — help changes with the screens.*
2. Video v1 with captions only, voice later? *Recommendation: yes.*
3. Start the pilot with Posts?
