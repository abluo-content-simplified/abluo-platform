import { NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { loadTranslateConfig } from '@/lib/translate/config'
import { getTranslationProvider } from '@/lib/translate/providers'
import { runTranslate } from '@/lib/translate/service'
import {
  TRANSLATE_ERROR_STATUS,
  TranslateError,
  type TranslateResponseBody,
} from '@/lib/translate/types'
import {
  currentEnvironment,
  getMonthToDateCharacters,
  projectIsMeterable,
  recordUsage,
} from '@/lib/translate/usage'
import { validateTranslateRequest } from '@/lib/translate/validate'

/**
 * POST /api/translate — ADR-023 §6.
 *
 * Translates one field's text into the requested languages with the project's
 * configured provider, records billed characters, enforces the monthly quota.
 * Returns error CODES only; the caller localizes them.
 *
 * v1 is Abluo-admin only (the button lives in Studio). The dashboard button
 * will authorize on `translate.use` instead (ADR-023 §1).
 */
export async function POST(request: Request) {
  const actor = await requireAbluoAdmin()
  if (!actor) return fail('forbidden')

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return fail('invalid_request')
  }

  try {
    const req = validateTranslateRequest(raw)
    const outcome = await runTranslate(req, actor.userId, {
      loadConfig: loadTranslateConfig,
      getProvider: getTranslationProvider,
      getMonthToDate: (projectId) => getMonthToDateCharacters(projectId),
      projectIsMeterable,
      recordUsage,
      environment: currentEnvironment(),
      logError: (message, err) => console.error(message, err),
    })
    const body: TranslateResponseBody = { ok: true, ...outcome }
    return NextResponse.json(body)
  } catch (err) {
    if (err instanceof TranslateError) {
      if (err.code === 'provider_error' || err.code === 'network_error') {
        console.error('[translate] provider failure', err.message)
      }
      return fail(err.code)
    }
    console.error('[translate] unexpected error', err)
    return fail('provider_error')
  }
}

function fail(code: TranslateError['code']) {
  const body: TranslateResponseBody = { ok: false, error: code }
  return NextResponse.json(body, { status: TRANSLATE_ERROR_STATUS[code] })
}
