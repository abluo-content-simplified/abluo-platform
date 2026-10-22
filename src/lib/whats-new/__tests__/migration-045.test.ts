/**
 * Text sanity for migration 045 (no database here): additive, RLS on, clients
 * can only read published rows and write only their own dismissals, nobody but
 * the service role writes notices. The real RLS behaviour is proven by applying
 * the file in the Supabase SQL editor (its self-check block raises on any gap).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/045_announcements_and_popup.sql'), 'utf8')
const code = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')

describe('migration 045', () => {
  it('is additive: no drop / delete / truncate / destructive alter', () => {
    expect(code).not.toMatch(/\bdrop\s+(table|column|policy|index)\b/i)
    expect(code).not.toMatch(/\bdelete\s+from\b/i)
    expect(code).not.toMatch(/\btruncate\b/i)
    expect(code).not.toMatch(/alter\s+table[^;]*\b(drop|rename)\b/i)
  })
  it('adds the pop-up flag defaulting to false, guarded', () => {
    expect(code).toMatch(/add column if not exists show_as_popup boolean not null default false/i)
  })
  it('enables RLS and revokes everything from anon / authenticated first, on both new tables', () => {
    for (const table of ['product_notices', 'product_notice_dismissals']) {
      expect(code).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
      expect(code).toMatch(new RegExp(`revoke all on table public\\.${table} from anon, authenticated, public`, 'i'))
    }
  })
  it('authenticated can only SELECT notices; only SELECT + INSERT on dismissals', () => {
    expect(code).toMatch(/grant select on table public\.product_notices to authenticated/i)
    expect(code).toMatch(/grant select, insert on table public\.product_notice_dismissals to authenticated/i)
    expect(code).not.toMatch(/grant[^;]*(insert|update|delete)[^;]*on table public\.product_notices to authenticated/i)
  })
  it('clients read published notices only; dismissals are own-row and need a published notice', () => {
    expect(code).toMatch(/on public\.product_notices\s+for select\s+to authenticated\s+using \(status = 'published'\)/i)
    expect(code).toMatch(/for insert\s+to authenticated\s+with check \(\s*user_id = \(select auth\.uid\(\)\)\s+and exists \(select 1 from public\.product_notices n where n\.id = notice_id and n\.status = 'published'\)/i)
    expect(code).toMatch(/on public\.product_notice_dismissals\s+for select\s+to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/i)
  })
  it('only info/warning, only a real window, only the three statuses', () => {
    expect(code).toMatch(/tone\s+text\s+not null default 'info' check \(tone in \('info', 'warning'\)\)/i)
    expect(code).toMatch(/check \(ends_at > starts_at\)/i)
    expect(code).toMatch(/status in \('draft', 'published', 'archived'\)/i)
  })
  it('is one transaction with a self-check', () => {
    expect(code).toMatch(/^begin;/im)
    expect(code).toMatch(/^commit;/im)
    expect(code).toMatch(/045 self-check passed/)
  })
})
