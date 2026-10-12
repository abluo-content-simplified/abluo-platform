#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo partner example — a minimal "fake TableRes" (ADR-031).
//
// The reference for a partner developer: the full Connect flow (authorization
// code + PKCE S256, confidential client), token storage, refresh rotation,
// the events sync loop with a cursor, and revocation. No dependencies.
//
//   ABLUO_URL=https://dev.abluo.app \
//   CLIENT_ID=abluo_app_… CLIENT_SECRET=abluo_cs_… \
//   node scripts/partner-example/server.mjs
//
// Then open http://localhost:4000. The app's registered return address must
// be http://localhost:4000/callback — localhost works only with sandbox
// (demo) websites, see CONNECTIONS_SANDBOX_PROJECT_IDS.
//
// A real partner keeps tokens and the cursor in its database, encrypted, per
// connected website — never in memory and never in the browser.
// ---------------------------------------------------------------------------

import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

const ABLUO = (process.env.ABLUO_URL || 'https://dev.abluo.app').replace(/\/$/, '')
const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const PORT = Number(process.env.PORT || 4000)
const REDIRECT = `http://localhost:${PORT}/callback`
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set CLIENT_ID and CLIENT_SECRET (from the Partner apps page).')
  process.exit(1)
}

// In-memory state for the demo only.
const pending = new Map() // state → code_verifier
let tokens = null // { access_token, refresh_token, expires_at }
let cursor = null
let events = new Map() // id → event
const log = []
const note = (line) => {
  log.unshift(`${new Date().toISOString()}  ${line}`)
  log.length = Math.min(log.length, 50)
}

const b64url = (buf) => buf.toString('base64url')
const basic = 'Basic ' + Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`).toString('base64')

async function tokenRequest(params) {
  const res = await fetch(`${ABLUO}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic },
    body: new URLSearchParams(params),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`token ${res.status}: ${body.error ?? ''} ${body.error_description ?? ''}`)
  tokens = { ...body, expires_at: Date.now() + body.expires_in * 1000 }
  return tokens
}

async function accessToken() {
  if (!tokens) throw new Error('Not connected.')
  // Refresh a little early. Each refresh returns a NEW refresh token: store it,
  // the old one is now retired (reusing it later disconnects the website).
  if (Date.now() > tokens.expires_at - 60_000) {
    await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
    note('refreshed tokens (rotation)')
  }
  return tokens.access_token
}

async function sync() {
  let pages = 0
  for (;;) {
    const url = new URL(`${ABLUO}/api/v1/events`)
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } })
    if (res.status === 401) {
      tokens = null
      throw new Error('Access refused: the website paused or disconnected this app. Ask the owner to connect again.')
    }
    const body = await res.json()
    if (!res.ok) throw new Error(`${res.status} ${body.title}: ${body.detail ?? ''}`)
    for (const item of body.data) {
      if (item.deleted) events.delete(item.id) // removed, unlisted or website-only: stop showing it
      else events.set(item.id, item)
    }
    cursor = body.next_cursor // persist this per website
    pages++
    if (!body.has_more) break
  }
  note(`sync: ${pages} page(s), ${events.size} event(s) held`)
}

const html = (inner) => `<!doctype html><meta charset="utf-8"><title>Partner example</title>
<style>body{font:15px system-ui;max-width:760px;margin:2rem auto;padding:0 1rem}a,button{margin-right:.5rem}pre{background:#f4f4f4;padding:1rem;overflow:auto;font-size:12px}</style>
<h1>Partner example</h1><p>Abluo: <code>${ABLUO}</code> · ${tokens ? '<b>connected</b>' : 'not connected'}</p>
<p><a href="/connect">Connect to Abluo</a><a href="/sync">Sync events</a><a href="/refresh">Refresh now</a><a href="/revoke">Disconnect</a></p>
${inner}<h2>Events (${events.size})</h2><pre>${escapeHtml(JSON.stringify([...events.values()], null, 2))}</pre><h2>Log</h2><pre>${escapeHtml(log.join('\n'))}</pre>`
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers })
    res.end(body)
  }
  try {
    if (url.pathname === '/connect') {
      const verifier = b64url(randomBytes(48)) // 64 chars, RFC 7636 alphabet
      const state = b64url(randomBytes(16))
      pending.set(state, verifier)
      const auth = new URL(`${ABLUO}/connect/authorize`)
      auth.search = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        scope: 'event:read eventVenue:read',
        state,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
      }).toString()
      return send(302, '', { location: auth.toString() })
    }
    if (url.pathname === '/callback') {
      const state = url.searchParams.get('state')
      const verifier = state && pending.get(state)
      pending.delete(state)
      if (!verifier) return send(400, html('<p>Unknown or reused state — start again.</p>'))
      if (url.searchParams.get('error')) {
        note(`connect declined: ${url.searchParams.get('error')}`)
        return send(302, '', { location: '/' })
      }
      await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code') ?? '', code_verifier: verifier, redirect_uri: REDIRECT })
      cursor = null
      events = new Map()
      note('connected: tokens received')
      return send(302, '', { location: '/sync' })
    }
    if (url.pathname === '/sync') {
      await sync()
      return send(302, '', { location: '/' })
    }
    if (url.pathname === '/refresh') {
      if (tokens) tokens.expires_at = 0
      await accessToken()
      return send(302, '', { location: '/' })
    }
    if (url.pathname === '/revoke') {
      if (tokens) {
        await fetch(`${ABLUO}/api/oauth/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic },
          body: new URLSearchParams({ token: tokens.refresh_token, token_type_hint: 'refresh_token' }),
        })
        tokens = null
        note('disconnected (refresh token revoked)')
      }
      return send(302, '', { location: '/' })
    }
    return send(200, html(''))
  } catch (e) {
    note(`error: ${e.message}`)
    return send(200, html(`<p style="color:#b00">${escapeHtml(e.message)}</p>`))
  }
}).listen(PORT, () => console.log(`Partner example on http://localhost:${PORT} → ${ABLUO}`))
