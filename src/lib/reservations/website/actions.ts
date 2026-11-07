'use server'
// ── Reservations website — server actions of the booking page and My pass ────
//
// Thin on purpose: validate the shape of the input, open the request context
// (project from the host, module installed, rate-limit hash) and hand over to
// run-actions.ts. The token arrives as an argument (it is the page's own URL)
// and is never logged or put in a result. Failures are dictionary keys only.
import { runAbsence, runCancelBooking, runPassAnswer } from './run-actions'
import { withWebsiteContext } from './context.server'
import type { ActionResult, BookingView, PassView } from './types'

type Base = { tenant: string; locale: string; token: string }

const isBase = (v: unknown): v is Base =>
  !!v && typeof v === 'object' && ['tenant', 'locale', 'token'].every((k) => typeof (v as Record<string, unknown>)[k] === 'string' && ((v as Record<string, string>)[k]).length <= 200)

async function run<V>(input: unknown, go: (ctx: Parameters<Parameters<typeof withWebsiteContext>[1]>[0]) => Promise<ActionResult<V>>): Promise<ActionResult<V>> {
  if (!isBase(input)) return { ok: false, error: 'generic' }
  const out = await withWebsiteContext(input, go)
  if (out.kind === 'ok') return out.value
  return { ok: false, error: out.kind === 'unavailable' ? 'unavailable' : 'generic' }
}

export async function cancelBookingAction(input: Base): Promise<ActionResult<BookingView>> {
  return run(input, (ctx) => runCancelBooking(ctx, { token: input.token }))
}

export async function absenceAction(input: Base & { occurrenceId: string }): Promise<ActionResult<BookingView>> {
  return run(input, (ctx) => runAbsence(ctx, { token: input.token, occurrenceId: input.occurrenceId }))
}

export async function passAnswerAction(input: Base & { occurrenceId: string; coming: boolean }): Promise<ActionResult<PassView>> {
  return run(input, (ctx) => runPassAnswer(ctx, { token: input.token, occurrenceId: input.occurrenceId, coming: input.coming }))
}
