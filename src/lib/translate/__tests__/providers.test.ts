import { describe, it, expect, vi } from 'vitest'
import { createGoogleProvider } from '../providers/google'
import { createDeepLProvider, deeplEndpoint } from '../providers/deepl'
import { createClaudeProvider, parseJsonArray } from '../providers/claude'
import { countCharacters, type FetchLike } from '../providers/types'
import { TranslateError } from '../types'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'resolved'
  } catch (err) {
    return err instanceof TranslateError ? err.code : 'other'
  }
}

describe('countCharacters', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(countCharacters(['abc', 'é'])).toBe(4)
    expect(countCharacters(['🧘'])).toBe(1)
  })
})

describe('Google adapter', () => {
  it('sends one batch with source, target, format and parses translations in order', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { translations: [{ translatedText: 'Accueil' }, { translatedText: 'Horaire' }] } })
    )
    const p = createGoogleProvider({ apiKey: 'k 1', fetchImpl })
    const out = await p.translate({ texts: ['Home', 'Timetable'], source: 'en', target: 'fr', format: 'text' })
    expect(out.texts).toEqual(['Accueil', 'Horaire'])
    expect(out.billedCharacters).toBe(13)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://translation.googleapis.com/language/translate/v2')
    expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('k 1')
    expect(JSON.parse(String(init?.body))).toEqual({
      q: ['Home', 'Timetable'], source: 'en', target: 'fr', format: 'text',
    })
  })

  it('is not configured without a key and refuses to call', async () => {
    const fetchImpl = vi.fn()
    const p = createGoogleProvider({ apiKey: '', fetchImpl })
    expect(p.isConfigured()).toBe(false)
    expect(await codeOf(p.translate({ texts: ['a'], source: 'en', target: 'fr', format: 'text' }))).toBe(
      'provider_not_configured'
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps HTTP errors, network errors and wrong counts to codes', async () => {
    const req = { texts: ['a', 'b'], source: 'en' as const, target: 'fr' as const, format: 'text' as const }
    expect(await codeOf(createGoogleProvider({ apiKey: 'k', fetchImpl: async () => jsonResponse({}, 403) }).translate(req))).toBe('provider_error')
    expect(await codeOf(createGoogleProvider({ apiKey: 'k', fetchImpl: async () => { throw new Error('down') } }).translate(req))).toBe('network_error')
    expect(
      await codeOf(
        createGoogleProvider({
          apiKey: 'k',
          fetchImpl: async () => jsonResponse({ data: { translations: [{ translatedText: 'x' }] } }),
        }).translate(req)
      )
    ).toBe('provider_error')
  })

  it('does not call the provider for an empty batch', async () => {
    const fetchImpl = vi.fn()
    const out = await createGoogleProvider({ apiKey: 'k', fetchImpl }).translate({ texts: [], source: 'en', target: 'fr', format: 'text' })
    expect(out).toEqual({ texts: [], billedCharacters: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('DeepL adapter', () => {
  it('routes :fx keys to the free endpoint', () => {
    expect(deeplEndpoint('abc:fx')).toBe('https://api-free.deepl.com/v2/translate')
    expect(deeplEndpoint('abc')).toBe('https://api.deepl.com/v2/translate')
  })

  it('uses regional target codes, html tag handling, and DeepL’s billed count', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ translations: [{ text: '<b>Hello</b>', billed_characters: 42 }] })
    )
    const out = await createDeepLProvider({ apiKey: 'k', fetchImpl }).translate({
      texts: ['<b>Ciao</b>'], source: 'it', target: 'en', format: 'html',
    })
    expect(out).toEqual({ texts: ['<b>Hello</b>'], billedCharacters: 42 })
    const [, init] = fetchImpl.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ source_lang: 'IT', target_lang: 'EN-GB', tag_handling: 'html', show_billed_characters: true })
    expect((init?.headers as Record<string, string>).Authorization).toBe('DeepL-Auth-Key k')
  })
})

describe('Claude adapter', () => {
  it('needs both a key and a model', () => {
    expect(createClaudeProvider({ apiKey: 'k', model: '' }).isConfigured()).toBe(false)
    expect(createClaudeProvider({ apiKey: 'k', model: 'm' }).isConfigured()).toBe(true)
  })

  it('parses the JSON array reply, even with surrounding prose', () => {
    expect(parseJsonArray('Here:\n["Bonjour", "Au revoir"]\n')).toEqual(['Bonjour', 'Au revoir'])
    expect(() => parseJsonArray('Bonjour')).toThrow(TranslateError)
    expect(() => parseJsonArray('[1, 2]')).toThrow(TranslateError)
  })

  it('sends the texts as JSON and returns them in order', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ content: [{ type: 'text', text: '["Nos professeurs"]' }] })
    )
    const out = await createClaudeProvider({ apiKey: 'k', model: 'm', fetchImpl }).translate({
      texts: ['Our teachers'], source: 'en', target: 'fr', format: 'text',
    })
    expect(out.texts).toEqual(['Nos professeurs'])
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.model).toBe('m')
    expect(body.messages[0].content).toContain('from English to French')
    expect(body.messages[0].content).toContain('["Our teachers"]')
  })
})
