// ── Catalogue — availability (DEPRECATED window vocabulary, removed in R3) ────
//
// Contract C2-C5-C10 §0 (Rev 4): under ADR-033 Amendment K-3 weekly windows no
// longer express availability. The interval arithmetic moved, unchanged, to
// ./commerce/windows.ts under the window vocabulary (WeeklyWindow, WindowState,
// evaluateWindows, windowsOverlap, windowIssues). Channel availability — with
// its own schedules — is ./commerce/availability-schedule.ts and
// ./commerce/channel-availability.ts (ChannelAvailabilityState, deliberately a
// different name from the AvailabilityState below).
//
// What remains here are deprecated aliases with their OLD values, kept for one
// release so existing callers (the legacy offer editor, offers.ts, the
// window-state field of CatalogueOfferDTO) keep compiling and behaving exactly
// as before. New code imports from ./commerce/windows.

import {
  evaluateWindows,
  windowApplies,
  windowIssues,
  windowRanges,
  windowsOverlap,
  type WeeklyWindow,
  type WindowIssue,
} from './commerce/windows'

export {
  WEEKDAYS,
  MINUTES_PER_DAY,
  MINUTES_PER_WEEK,
  minutesOf,
  weekdayOf,
  localPosition,
  type Weekday,
} from './commerce/windows'

/** @deprecated R3 — use WeeklyWindow (./commerce/windows). */
export type AvailabilityRule = WeeklyWindow

/** @deprecated R3 — use WindowState ('inWindow' | 'outsideWindow'). Old values kept: 'available' | 'outOfHours'. */
export type AvailabilityState = 'available' | 'outOfHours'

/** @deprecated R3 — use windowRanges. */
export const ruleRanges = windowRanges

/** @deprecated R3 — use windowApplies. */
export const ruleApplies = windowApplies

/** @deprecated R3 — use evaluateWindows. Returns the old vocabulary. No rules = 'available'. */
export function evaluate(
  rules: readonly AvailabilityRule[] | null | undefined,
  instant: Date | string,
  timeZone: string,
): AvailabilityState {
  return evaluateWindows(rules, instant, timeZone) === 'inWindow' ? 'available' : 'outOfHours'
}

/** @deprecated R3 — use windowsOverlap. */
export const rulesOverlap = windowsOverlap

/** @deprecated R3 — use WindowIssue. */
export type AvailabilityIssue = WindowIssue

/** @deprecated R3 — use windowIssues. */
export const ruleIssues = windowIssues
