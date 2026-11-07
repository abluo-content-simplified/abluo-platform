// Test helper: a recording fake of the supabase client slice the store uses.
export type Call = { kind: 'rpc'; fn: string; args: Record<string, unknown> } | { kind: 'from'; table: string; ops: Array<[string, unknown[]]> }
type Reply = { data?: unknown; error?: { code?: string; message?: string; details?: string } | null }

export function fakeDb(reply: Reply | ((c: Call) => Reply) = { data: null, error: null }) {
  const calls: Call[] = []
  const answer = (c: Call): Reply => (typeof reply === 'function' ? reply(c) : reply)
  const db = {
    rpc(fn: string, args: Record<string, unknown>) {
      const c: Call = { kind: 'rpc', fn, args }
      calls.push(c)
      const r = answer(c)
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    },
    from(table: string) {
      const c: Call = { kind: 'from', table, ops: [] }
      calls.push(c)
      const chain: any = new Proxy({}, { // eslint-disable-line @typescript-eslint/no-explicit-any
        get(_t, prop: string) {
          if (prop === 'then') {
            const r = answer(c)
            return (res: (v: unknown) => void) => res({ data: r.data ?? null, error: r.error ?? null })
          }
          return (...a: unknown[]) => { c.ops.push([prop, a]); return chain }
        },
      })
      return chain
    },
  }
  return { db, calls }
}

export const opsOf = (c: Call, name: string) => (c.kind === 'from' ? c.ops.filter(([n]) => n === name).map(([, a]) => a) : [])
