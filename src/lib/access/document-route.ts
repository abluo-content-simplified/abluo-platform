/**
 * Site Access — the protected-document route, wired to the request (B2.4).
 * Logic and policy live in ./delivery.ts; this file only reads the request
 * and the environment. Route-level tests: __tests__/document-route.test.ts.
 */
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { accessEnvironment, withSiteAccessStore } from './server'
import { decideDocument, deliveryLocales, denyResponse, fileResponse } from './delivery'
import { ACCESS_NOTICE_PARAM, ACCESS_WAIT_PARAM, accessSiteBase, isSecureAccessRequest, isSupportedLocale, parseAccessNotice, readCookie, requestOrigin, resolveAccessRouteProject, signInPath } from './request'
import { sessionCookieName } from './session-token'
import { resolveVisitor } from './visitor'
import { accessModuleEnabled } from './visitor-routes'

type Params = { locale: string; tenant: string; documentId: string }

export async function handleDocument(request: Request, params: Params): Promise<Response> {
  const h = request.headers
  const url = new URL(request.url)
  const download = url.searchParams.get('download') === '1'
  const origin = requestOrigin(h)
  const project = isSupportedLocale(params.locale) ? resolveAccessRouteProject(h.get('host'), params.tenant) : null

  // The page a refused browser is sent to (and the path to come back to).
  // Unknown host / project / language: still the same refusal shape.
  const siteBase = project ? accessSiteBase(params.locale, project) : `/${params.locale}`
  const ownPath = `${siteBase}/site-access/documents/${encodeURIComponent(params.documentId)}${download ? '?download=1' : ''}`
  const signIn = new URL(signInPath(siteBase, ownPath), origin ?? 'https://invalid.invalid')
  // A failed sign-in comes back here with its one-word outcome; pass it on so
  // the prompt can say what happened (only known values survive parsing).
  const { notice, waitMinutes } = parseAccessNotice(Object.fromEntries(url.searchParams))
  if (notice) {
    signIn.searchParams.set(ACCESS_NOTICE_PARAM, notice)
    if (waitMinutes) signIn.searchParams.set(ACCESS_WAIT_PARAM, String(waitMinutes))
  }
  if (!project || !origin) return denyResponse(h, signIn)

  const token = readCookie(h, sessionCookieName(project.projectId, isSecureAccessRequest(h)))
  const environment = accessEnvironment()
  const locales = deliveryLocales(params.locale, resolveScopeFromProjectSegment(project.segment)?.defaultLocale)

  try {
    return await withSiteAccessStore('protected document route: authorise a visitor and serve a private PDF', async (store, files) => {
      const decision = await decideDocument(
        { projectId: project.projectId, documentId: params.documentId, locales, token },
        {
          store,
          environment,
          resolveVisitor: (t) => resolveVisitor({ store, projectId: project.projectId, environment, token: t }),
          moduleEnabled: () => accessModuleEnabled(project, params.locale),
        }
      )
      if (decision.kind === 'deny') return denyResponse(h, signIn)
      return fileResponse({ method: request.method, headers: h, download, locale: params.locale }, decision.file, files)
    })
  } catch {
    return denyResponse(h, signIn)
  }
}
