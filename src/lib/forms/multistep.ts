/**
 * Multi-step + context-aware helpers — ADR-018 slice 5.
 *
 * Pure, framework-free logic for the multi-step Form Section renderer:
 *  - map a placement's Context onto `contextMappable` fields (client mirror of
 *    the server's sanitizeContext — the server remains authoritative, §18);
 *  - decide the first step a visitor should land on, given pre-filled values
 *    (the ADR-018 §7 "open at the first step with an unsatisfied required
 *    field", computed from actual values — never a configured startAtStep).
 *
 * Kept pure so the step algebra is unit-tested without rendering or network.
 */
import type { RenderableFormDefinition, RenderableFormField, RenderableFormStep } from '@/lib/sanity/types'

/** A value counts as "empty" (unsatisfied) for a required-field check. */
export function isEmptyValue(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0) ||
    v === false
  )
}

/** All field keys in the definition that a placement's Context may set. */
export function contextMappableKeys(def: RenderableFormDefinition): Set<string> {
  const keys = new Set<string>()
  for (const step of def.steps) {
    for (const f of step.fields) {
      if (f.contextMappable) keys.add(f.id)
    }
  }
  return keys
}

/**
 * Maps a raw placement Context onto initial field values — ONLY for fields the
 * definition marks `contextMappable`. Mirrors the server's sanitizeContext so
 * the UI never pre-fills a field the server would reject. Unknown / non-mappable
 * keys are dropped.
 */
export function mapContextToValues(
  def: RenderableFormDefinition,
  context: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!context) return {}
  const mappable = contextMappableKeys(def)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(context)) {
    if (mappable.has(k) && !isEmptyValue(v)) out[k] = v
  }
  return out
}

/** True if every required field in the step has a non-empty value. */
export function isStepSatisfied(step: RenderableFormStep, values: Record<string, unknown>): boolean {
  return step.fields.every((f: RenderableFormField) => !f.required || !isEmptyValue(values[f.id]))
}

/**
 * Index of the first step with an unsatisfied required field, given `values`
 * (ADR-018 §7). If every step is already satisfied, returns the LAST step index
 * — there is always a final step to review + consent + submit. Empty
 * definitions return 0.
 */
export function firstIncompleteStepIndex(
  def: RenderableFormDefinition,
  values: Record<string, unknown>,
): number {
  if (def.steps.length === 0) return 0
  const idx = def.steps.findIndex((s) => !isStepSatisfied(s, values))
  return idx === -1 ? def.steps.length - 1 : idx
}

/**
 * The leading steps (before the landing step) that Context has fully satisfied,
 * in order. The renderer submits these to the server first — advancing the
 * rotating token to the landing step — before showing the visitor anything.
 * A leading step that is NOT fully satisfied stops the run (that step becomes
 * the landing step), so a partially-known step is never silently auto-submitted.
 */
export function autoAdvanceSteps(
  def: RenderableFormDefinition,
  values: Record<string, unknown>,
): RenderableFormStep[] {
  const landing = firstIncompleteStepIndex(def, values)
  const out: RenderableFormStep[] = []
  for (let i = 0; i < landing; i++) {
    if (!isStepSatisfied(def.steps[i], values)) break
    out.push(def.steps[i])
  }
  return out
}

/** Whitelists `values` to the keys belonging to `step` (client mirror of the server). */
export function stepValues(step: RenderableFormStep, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of step.fields) {
    if (!isEmptyValue(values[f.id])) out[f.id] = values[f.id]
  }
  return out
}

export function isFinalStepIndex(def: RenderableFormDefinition, index: number): boolean {
  return index === def.steps.length - 1
}
