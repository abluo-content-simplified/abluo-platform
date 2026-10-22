/**
 * The admin-only facts recorded with a new request (ADR-039 D2, D9). Pure.
 * Anything the browser sends is untrusted: each value is shortened and the
 * page path is accepted only when it is a dashboard path of the same project.
 */
import type { TicketContext } from './model'

const MAX = { page: 300, platformVersion: 40, userAgent: 400, viewport: 20, interfaceLocale: 10, role: 20, relatedTo: 20 }

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return v ? v.slice(0, max) : undefined
}

/**
 * Keep `from` only when it is a same-origin path inside this project's
 * dashboard: `/martegani/posts/…` or `/it/martegani/posts/…`. Query and hash
 * are dropped (they can carry anything). Never echoed back as a link target
 * to anyone but the Abluo admin.
 */
export function sanitizeFromPath(from: unknown, projectSlug: string): string | undefined {
  if (typeof from !== 'string') return undefined
  const raw = from.trim()
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return undefined
  const path = raw.split(/[?#]/)[0]
  if (path.length > MAX.page || /[^A-Za-z0-9\-._~/%]/.test(path)) return undefined
  const segments = path.split('/').filter(Boolean)
  if (segments.some((s) => s === '..' || s === '.')) return undefined
  const at = segments.indexOf(projectSlug)
  if (at !== 0 && at !== 1) return undefined
  if (at === 1 && !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(segments[0])) return undefined
  return '/' + segments.join('/')
}

export function buildTicketContext(input: {
  from?: unknown
  projectSlug: string
  platformVersion?: unknown
  userAgent?: unknown
  viewport?: unknown
  interfaceLocale?: unknown
  role?: unknown
  relatedTo?: unknown
}): TicketContext {
  const ctx: TicketContext = {}
  const page = sanitizeFromPath(input.from, input.projectSlug)
  if (page) ctx.page = page
  const pv = clip(input.platformVersion, MAX.platformVersion)
  if (pv) ctx.platformVersion = pv
  const ua = clip(input.userAgent, MAX.userAgent)
  if (ua) ctx.userAgent = ua
  const vp = clip(input.viewport, MAX.viewport)
  if (vp && /^\d{2,5}x\d{2,5}$/.test(vp)) ctx.viewport = vp
  const loc = clip(input.interfaceLocale, MAX.interfaceLocale)
  if (loc && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(loc)) ctx.interfaceLocale = loc
  const role = clip(input.role, MAX.role)
  if (role) ctx.role = role
  const rel = clip(input.relatedTo, MAX.relatedTo)
  if (rel && /^ABL-\d{6,}$/.test(rel)) ctx.relatedTo = rel
  return ctx
}
