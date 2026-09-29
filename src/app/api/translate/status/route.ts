import { NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { loadTranslateConfig } from '@/lib/translate/config'
import { getTranslationProvider } from '@/lib/translate/providers'
import { getTranslateStatus } from '@/lib/translate/service'
import {
  TRANSLATE_ERROR_STATUS,
  TranslateError,
  type TranslateStatusBody,
} from '@/lib/translate/types'
import { getMonthToDateCharacters } from '@/lib/translate/usage'

/**
 * GET /api/translate/status?projectSlug=… — ADR-023 §6.
 *
 * Lets the Studio show, disable or explain the Translate button before anyone
 * clicks: module on/off, provider key present, quota and month-to-date usage.
 */
export async function GET(request: Request) {
  const actor = await requireAbluoAdmin()
  if (!actor) return fail('forbidden')

  const projectSlug = new URL(request.url).searchParams.get('projectSlug') ?? ''
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectSlug)) return fail('invalid_request')

  try {
    const body: TranslateStatusBody = await getTranslateStatus(projectSlug, {
      loadConfig: loadTranslateConfig,
      getProvider: getTranslationProvider,
      getMonthToDate: (projectId) => getMonthToDateCharacters(projectId),
      logError: (message, err) => console.error(message, err),
    })
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof TranslateError) return fail(err.code)
    console.error('[translate] status: unexpected error', err)
    return fail('usage_unavailable')
  }
}

function fail(code: TranslateError['code']) {
  const body: TranslateStatusBody = { ok: false, error: code }
  return NextResponse.json(body, { status: TRANSLATE_ERROR_STATUS[code] })
}
