import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Browser, type Page } from '@playwright/test'

/**
 * Data integrity of autosave (performance work 2026-10-16) — functional tests,
 * NOT load tests. They prove that faster saving did not make it possible to
 * lose or silently overwrite an edit.
 *
 *   1. Two browsers, same field: the later save is refused ("Edited elsewhere"),
 *      the first one stays, and the refused text is kept on screen.
 *   2. Two browsers save the same field at the same moment: exactly one wins.
 *   3. Fast typing (many saves in a row): the stored text is exactly what was typed.
 *   4. Network lost while typing: never "Saved" while offline; everything saved
 *      once back online.
 *   5. Tab closed before the autosave fired: reopening restores the text and saves it.
 *
 * Runs on the shared autosave engine through the blog-post editor (every editor
 * uses the same engine and the same `ifRevisionId` write). Publishing is not
 * exercised here: dev shares the production dataset, so a test publish would
 * appear on the live website — that case waits for the isolated test environment.
 *
 * Writes to the test project, so it runs only with E2E_WRITE=1, only on
 * localhost or dev.abluo.app, only on the desktop-light project (once, not 4×).
 * Every draft it creates carries "[e2e]" in its title and is deleted afterwards
 * (Sanity API, write token from .env.local — never printed).
 *
 *   E2E_WRITE=1 E2E_BASE_URL=https://dev.abluo.app npx playwright test e2e/client/data-integrity.spec.ts --project=desktop-light
 */
const project = process.env.E2E_PROJECT ?? 'abluo'
const WRITE = process.env.E2E_WRITE === '1'
const AUTH = 'e2e/.auth/client.json'
const created: string[] = []

test.describe.configure({ mode: 'serial' })

/**
 * Vercel's preview toolbar (`<vercel-live-feedback>`) overlays non-production
 * deployments and intercepts clicks; it never reaches a visitor. Same init
 * script as e2e/i18n/language-switching.spec.ts.
 */
const HIDE_VERCEL_TOOLBAR = () => {
  const hide = () => {
    const style = document.createElement('style')
    style.textContent = 'vercel-live-feedback,vercel-toolbar{display:none!important;pointer-events:none!important}'
    document.head?.appendChild(style)
  }
  if (document.head) hide()
  else document.addEventListener('DOMContentLoaded', hide)
}

test.beforeEach(async ({ context }, info) => {
  test.skip(!WRITE, 'set E2E_WRITE=1 — these tests create (and delete) drafts on the test project')
  test.skip(info.project.name !== 'desktop-light', 'data-integrity runs once, on desktop-light')
  const host = new URL(info.project.use.baseURL ?? 'http://localhost:3000').host
  if (!/^(localhost(:\d+)?|dev\.abluo\.app)$/.test(host)) throw new Error(`Refusing to write test drafts on ${host} — only localhost or dev.abluo.app`)
  await context.addInitScript(HIDE_VERCEL_TOOLBAR)
})

test.afterAll(async () => {
  if (!created.length) return
  const env = readEnv()
  const require = createRequire(`${process.cwd()}/package.json`)
  const { createClient } = require('@sanity/client') as typeof import('@sanity/client')
  const client = createClient({
    projectId: env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3',
    dataset: env.NEXT_PUBLIC_SANITY_DATASET || 'production',
    apiVersion: '2026-05-21',
    useCdn: false,
    token: env.SANITY_API_WRITE_TOKEN,
  })
  for (const id of created) {
    // Only ever this test's own never-published drafts on the test project.
    const doc = (await client.getDocument(`drafts.${id}`)) as { projectSlug?: string; title?: Record<string, string> } | undefined
    if (doc && doc.projectSlug === project && JSON.stringify(doc.title ?? {}).includes('[e2e]') && !(await client.getDocument(id))) {
      await client.delete(`drafts.${id}`)
    }
  }
})

function readEnv(): Record<string, string> {
  if (!existsSync('.env.local')) return process.env as Record<string, string>
  const out: Record<string, string> = { ...(process.env as Record<string, string>) }
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && !out[m[1]]) out[m[1]] = m[2]
  }
  return out
}

const saveState = (page: Page) => page.locator('[data-save-state]').first()
// By id: until the TitleStep duplicate-id fix is deployed, the "Title" label points at the heading.
const titleField = (page: Page) => page.locator('textarea#title-step-title')

/** Moves past the optional topic step to the title step. */
async function toTitleStep(page: Page) {
  const topic = page.getByRole('heading', { level: 1, name: "What's this post about?" })
  if (await topic.isVisible().catch(() => false)) await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Give your story a title' })).toBeVisible()
}

/** Creates a new post draft through the app and saves a first title; returns its id. */
async function newDraft(page: Page, label: string): Promise<string> {
  await page.goto(`/en/${project}/home`)
  await page.getByRole('button', { name: 'Add content' }).filter({ visible: true }).first().click()
  await page.getByRole('dialog', { name: 'What would you like to create?' }).getByRole('button', { name: /Blog post/ }).click()
  // Lazy creation: the editor opens at /posts/write/new and the draft only exists
  // once the first title is saved; then the URL becomes /posts/write/<id>.
  await expect(page).toHaveURL(new RegExp(`/en/${project}/posts/write/(new|[0-9a-f-]{36})$`))
  await toTitleStep(page)
  await titleField(page).fill(`[e2e] ${label} ${Date.now()}`)
  await expect(saveState(page)).toHaveAttribute('data-save-state', 'saved', { timeout: 15_000 })
  await expect(page).toHaveURL(new RegExp(`/en/${project}/posts/write/[0-9a-f-]{36}$`), { timeout: 15_000 })
  const id = page.url().split('/').pop()!
  created.push(id)
  return id
}

async function openIn(browser: Browser, id: string) {
  const context = await browser.newContext({ storageState: AUTH })
  await context.addInitScript(HIDE_VERCEL_TOOLBAR)
  const page = await context.newPage()
  await page.goto(`/en/${project}/posts/write/${id}`)
  await toTitleStep(page)
  return { context, page }
}

/** The title as stored on the server (fresh page, nothing journaled in that context). */
async function storedTitle(browser: Browser, id: string) {
  const { context, page } = await openIn(browser, id)
  const v = await titleField(page).inputValue()
  await context.close()
  return v
}

test('1 — two browsers, same field: the later save is refused, nothing is overwritten', async ({ page, browser }) => {
  const id = await newDraft(page, 'conflict')
  const b = await openIn(browser, id) // B loads the same revision A has

  const textA = `[e2e] A wrote this ${Date.now()}`
  await titleField(page).fill(textA)
  await expect(saveState(page)).toHaveAttribute('data-save-state', 'saved', { timeout: 15_000 })

  const textB = `[e2e] B wrote this ${Date.now()}`
  await titleField(b.page).fill(textB)
  await expect(saveState(b.page)).toHaveAttribute('data-save-state', 'conflict', { timeout: 15_000 })
  await expect(titleField(b.page)).toHaveValue(textB) // B's words stay on B's screen

  expect(await storedTitle(browser, id)).toBe(textA) // A's save was not overwritten
  await b.context.close()
})

test('2 — two browsers save the same field at the same moment: exactly one wins', async ({ page, browser }) => {
  const id = await newDraft(page, 'race')
  const b = await openIn(browser, id)
  const textA = `[e2e] race A ${Date.now()}`
  const textB = `[e2e] race B ${Date.now()}`
  await Promise.all([titleField(page).fill(textA), titleField(b.page).fill(textB)])
  const settled = (p: Page) =>
    expect(saveState(p)).toHaveAttribute('data-save-state', /^(saved|conflict)$/, { timeout: 15_000 }).then(() => saveState(p).getAttribute('data-save-state'))
  const [sa, sb] = await Promise.all([settled(page), settled(b.page)])
  expect([sa, sb].sort()).toEqual(['conflict', 'saved'])
  expect(await storedTitle(browser, id)).toBe(sa === 'saved' ? textA : textB)
  await b.context.close()
})

test('3 — fast typing (many consecutive saves): the stored text is exactly what was typed', async ({ page, browser }) => {
  const id = await newDraft(page, 'fast')
  const field = titleField(page)
  await field.fill('[e2e] ')
  const words = ['quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog', 'again', 'and', 'again']
  for (const w of words) {
    await field.press('End')
    await page.keyboard.type(`${w} `, { delay: 35 })
    await page.waitForTimeout(250 + Math.round(Math.random() * 600)) // around the 500 ms pause: some saves fire mid-typing
  }
  const expected = `[e2e] ${words.join(' ')} `.trimEnd()
  await expect(saveState(page)).toHaveAttribute('data-save-state', 'saved', { timeout: 15_000 })
  expect((await storedTitle(browser, id)).trimEnd()).toBe(expected)
})

test('4 — network lost while typing: never "Saved" while offline, everything saved once back', async ({ page, browser, context }) => {
  const id = await newDraft(page, 'offline')
  await context.setOffline(true)
  const text = `[e2e] typed while offline ${Date.now()}`
  await titleField(page).fill(text)
  await expect(saveState(page)).toHaveAttribute('data-save-state', 'offline', { timeout: 15_000 })
  await page.waitForTimeout(1500)
  await expect(saveState(page)).not.toHaveAttribute('data-save-state', 'saved')
  await context.setOffline(false)
  await expect(saveState(page)).toHaveAttribute('data-save-state', 'saved', { timeout: 20_000 })
  expect(await storedTitle(browser, id)).toBe(text)
})

test('5 — tab closed before the autosave fired: reopening restores the text and saves it', async ({ page, browser, context }) => {
  const id = await newDraft(page, 'close')
  const text = `[e2e] closed mid-typing ${Date.now()}`
  await titleField(page).fill(text)
  await page.close() // well before the 500 ms pause ends
  const again = await context.newPage() // same browser profile → same local journal
  await again.goto(`/en/${project}/posts/write/${id}`)
  await toTitleStep(again)
  await expect(titleField(again)).toHaveValue(text)
  await expect(saveState(again)).toHaveAttribute('data-save-state', 'saved', { timeout: 15_000 })
  expect(await storedTitle(browser, id)).toBe(text)
})
