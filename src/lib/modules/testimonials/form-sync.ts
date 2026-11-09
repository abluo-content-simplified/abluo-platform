// ── Testimonials module — silent form ownership (ADR-048 D4) ──────────────────
//
// The WhatsApp pattern (src/lib/modules/whatsapp/form-sync.ts): when the
// Modules pane saves the testimonials module with `acceptSubmissions` ON, the
// module makes sure its own `formDefinition` exists. The tenant never picks or
// builds a form. Studio-safe: it takes the Sanity client as an argument and
// imports nothing server-only.
//
// Existing form: a platform-owned IDENTITY (formId, tenantSlug, type, role) is
// always set; everything else (labels, help, success text, consent) is only
// filled where missing, so wording an admin adjusted in Studio survives.
// Turning `acceptSubmissions` OFF does not delete the form or its submissions;
// the website stops offering it, and past submissions stay in the dashboard.

import { TESTIMONIAL_ACCEPT_SUBMISSIONS_KEY } from './model'
import { buildTestimonialFormDocument, buildTestimonialFormPatch, testimonialFormDocId } from './form'

/** The two Sanity client methods the sync uses. */
export type TestimonialFormClient = {
  createIfNotExists: (doc: { _id: string; _type: string } & Record<string, unknown>) => Promise<unknown>
  patch: (id: string) => {
    setIfMissing: (v: Record<string, unknown>) => { set: (v: Record<string, unknown>) => { commit: () => Promise<unknown> } }
  }
}

/** Keys that identify the form and are always (re)written. */
const IDENTITY_KEYS = ['formId', 'tenantSlug', 'formType', 'role'] as const

/** Whether a saved module config asks for the form. */
export function acceptsTestimonialSubmissions(config: Record<string, unknown> | null | undefined): boolean {
  return config?.[TESTIMONIAL_ACCEPT_SUBMISSIONS_KEY] === true
}

/** Creates the form if missing, otherwise fills what is missing. Returns the form document id. */
export async function syncTestimonialForm(client: TestimonialFormClient, input: { tenantSlug: string }): Promise<string> {
  const docId = testimonialFormDocId(input.tenantSlug)
  await client.createIfNotExists(buildTestimonialFormDocument(input) as { _id: string; _type: string } & Record<string, unknown>)
  const patch = buildTestimonialFormPatch(input)
  const identity: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if ((IDENTITY_KEYS as readonly string[]).includes(k)) identity[k] = v
    else rest[k] = v
  }
  await client.patch(docId).setIfMissing(rest).set(identity).commit()
  return docId
}
