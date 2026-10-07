/**
 * In-memory stand-in for the service-role Supabase client — just the query
 * shapes src/lib/invitations and the tenant-context loader use.
 */
type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

let seq = 0
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

export function fakeAdmin(tables: Tables, users: Record<string, { id: string; email: string; app_metadata?: Row }>) {
  function from(table: string) {
    tables[table] ??= []
    const filters: Array<(r: Row) => boolean> = []
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    let returning = false
    const matched = () => tables[table].filter((r) => filters.every((f) => f(r)))
    const run = (): Row[] => {
      if (op === 'insert') {
        const row: Row = { id: id(), expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), accepted_at: null, revoked_at: null, ...payload }
        if (table === 'invitations' && tables.invitations.some((r) => r.token_hash === row.token_hash)) throw new Error('dup')
        tables[table].push(row)
        return [row]
      }
      if (op === 'update') {
        const rows = matched()
        rows.forEach((r) => Object.assign(r, payload))
        return rows
      }
      return matched()
    }
    const b: Record<string, unknown> = {
      select: () => ((returning = true), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
      gt: (k: string, v: string) => (filters.push((r) => String(r[k]) > v), b),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), b),
      insert: (p: Row) => ((op = 'insert'), (payload = p), b),
      update: (p: Row) => ((op = 'update'), (payload = p), b),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const r = run()[0]
        return { data: r ?? null, error: r ? null : { message: 'none' } }
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: op === 'select' || returning ? run() : (run(), null), error: null }).then(resolve),
    }
    return b
  }
  return {
    from,
    auth: {
      admin: {
        getUserById: async (uid: string) => ({ data: { user: Object.values(users).find((u) => u.id === uid) ?? null }, error: null }),
        createUser: async (o: { email: string }) => {
          if (Object.values(users).some((u) => u.email === o.email)) return { data: { user: null }, error: { message: 'A user with this email address has already been registered', status: 422 } }
          const u = { id: id(), email: o.email, app_metadata: {} }
          users[o.email] = u
          return { data: { user: u }, error: null }
        },
      },
    },
  }
}
