# ADR-042 — Dashboard navigation foundation: grouped, collapsible sidebar with module sub-destinations

**Status: Accepted — Tom, 2026-11-02 (structure, behaviour and placements; clarifications of the same day applied).** Nothing implemented. Implementation against the shared sidebar files waits until the billing work has landed.
Date: 2026-11-02.
Origin: Catalogue redesign brief §4 and Tom's decision 1 of 2026-11-02 — adopted **platform-wide**, delivered as its **own platform slice**, not inside a Catalogue slice (ADR-033 Amendment K, K-1).
Builds on: ADR-029 (tenant dashboard), ADR-030 (shared Abluo App layer), ADR-028 (permissions), PLAT-3 (`src/lib/modules/order.ts`), the Component Lab rule, the English Title Case rule for navigation labels.
**Supersedes:** PLAT-3's use **in the dashboard sidebar** (groups Publish / Show / Visitors / Tools). PLAT-3 keeps governing module order in Studio.

---

## 1. Context

The sidebar today is one flat list split by group headings (PLAT-3), with Home at the top and the 2026-10-29 bottom group (Connected Apps, Settings, Support, What's New, More You Can Add). A module has exactly one entry; internal areas are tabs inside the page (Catalogue's Items / Collections / Option lists). As modules gain internal areas (Catalogue, later Events 2.0, Forms, Brand Hub) tabs do not scale, and tablets lose too much width to a fixed sidebar.

## 2. Decisions

**N1 — Groups.** The sidebar is: **Home**, then groups **Content · Catalogue · Visitors · Library · Insights · Project**. Installed modules and permissions decide which entries — and therefore which groups — appear; an empty group is not shown.

**N2 — A module may own a group with sub-destinations.** Catalogue is the first: a top-level group **Catalogue** with **Items · Collections · Options · Setup**. Sub-destinations are real routes (deep-linkable), not tabs; each declares its own permission.

**N3 — Groups collapse independently.** The group containing the current destination opens automatically. Open/closed state is remembered **per user** (not per device only). Badges stay visible on a collapsed group (aggregated on the group header).

**N4 — The whole sidebar collapses on desktop and tablet.** Expanded: icons + labels. Collapsed: an icon rail with accessible tooltips (keyboard focus shows them too; the label is the accessible name). The current destination stays evident in both modes. In rail mode a group shows its icon; activating it opens a flyout listing its destinations. The preference is remembered per user.

**N4a — First-use defaults.** Desktop: **expanded**. Tablet: **collapsed to the icon rail**. Phone: drawer, no permanent rail. Once the person changes it, their remembered preference wins. Preferences are stored **per layout** (desktop and tablet independently), so a breakpoint change never overwrites the preference for the other layout.

**N5 — Phones use the drawer.** No permanent rail on phones. The existing drawer (opened from the right) and bottom tab bar continue; the drawer uses the same groups and sub-destinations. The "Content" bottom sheet is rebuilt from N1 groups.

**N2a — Catalogue group navigation.**
- `/catalogue` redirects to **Catalogue → Items**; Items is the default Catalogue destination.
- Expanded sidebar: the **Catalogue group heading opens or closes** its destinations (it is a disclosure control, not a link).
- Rail mode: activating Catalogue opens the **destination flyout**.
- Nested item routes (an item's editor, the new-item flow) highlight **Catalogue → Items**; likewise collection and option routes their own destinations.
- **Setup** is shown only to people with the Setup permission (ADR-033 K-5 / C8); a direct link without it is refused like any other permission failure.

**N6 — One definition.** Groups, order, icons, sub-destinations and permissions are declared once (in `src/lib/client/surfaces.ts` and the module manifests) and consumed by desktop sidebar, rail, drawer, bottom bar and Home. No surface keeps its own list.

**N7 — Nothing regresses.** Permission filtering (fail-closed), deep links, active state (including nested routes such as `/catalogue/items/[id]` lighting Catalogue → Items), the project switcher and the presence/news rows keep working. Covered by tests for: entry visibility by permission, active-state resolution, group auto-open, preference persistence.

**N8 — Built from shared components.** The sidebar group, collapsible group header, rail item with tooltip and flyout are shared components in `src/components/app/ui` with Component Lab entries and demos (rule of two), usable by the admin dashboard too (ADR-030).

**N9 — Labels.** English Title Case ("Contact Requests", "Categories & Tags", "Connected Apps"); Italian and German by their own rules; all from the interface dictionaries. Module groups have fixed names (the Catalogue group is always "Catalogue" — ADR-033 K-2).

## 3. Placement of today's destinations

| Group | Destinations |
|---|---|
| (top) | Home |
| Content | Posts · News · Events · FAQ · Galleries · Documents · Live |
| Catalogue | Items · Collections · Options · Setup |
| Visitors | Contact Requests (Forms) · WhatsApp — day-to-day messages, requests and conversations · Access |
| Library | Media · People · Categories & Tags · Brand Hub |
| Insights | Analytics |
| Project | Connected Apps (incl. connecting and configuring the WhatsApp service) · Settings · Billing · Translate — the project-wide translation/language workspace |
| (bottom) | Support · What's New · More You Can Add — the 2026-10-29 bottom block, unchanged |

Confirmed by Tom, 2026-11-02. **Contextual actions stay where the work is:** individual translation actions remain available inside the content being edited; WhatsApp configuration is never duplicated under Visitors.

## 4. Persistence

Sidebar collapsed/expanded (per layout, N4a) and each group's open state are per-user preferences stored server-side with the existing per-person preferences (same mechanism as `useViewPreference`), with a client cache so the first paint matches the stored state (no flash). Unknown or removed groups are ignored.

## 5. Consequences

- `MODULE_GROUPS` stops driving the dashboard sidebar; `PHONE_CONTENT_GROUPS` and `client-nav-layout.ts` are rewritten against N1.
- `ClientSidebar.tsx` is rewritten on the new shared components. **Coordination:** it is currently being touched by the billing work (uncommitted change on 2026-11-02); the navigation slice starts after that lands.
- Catalogue's `SegmentedControl` tabs are removed when N2 ships (ADR-033 K-1).
- Verification per `docs/engineering/client-dashboard/verification.md`: light/dark × phone/tablet/desktop, keyboard, screen reader names, both dashboards where the shared layer is used.
