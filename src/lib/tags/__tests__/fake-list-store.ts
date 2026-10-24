import { vi } from 'vitest'

/**
 * Test helper: gives a fake Sanity client an in-memory `internalTagList` store.
 * The list query (by id + projectSlug) is answered from the store; list ops in
 * a transaction (createIfNotExists, setIfMissing, insert after tags[-1]) are
 * applied when that transaction commits — other ops go to the client's own
 * fake. A fake transaction is created when the client has none.
 */
type Op = { kind: 'create'; doc: { _id: string; projectSlug: string; scope: string; tags: string[] } } | { kind: 'patch'; id: string; ops: Record<string, unknown> }
export type ListDoc = { projectSlug: string; scope: string; tags?: string[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withListStore(client: any, initial: Record<string, ListDoc> = {}, opts: { failListCommit?: boolean } = {}) {
  const lists = new Map<string, ListDoc>(Object.entries(initial).map(([id, d]) => [id, { ...d, tags: d.tags ? [...d.tags] : d.tags }]))
  const realFetch = client.fetch
  client.fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}, o?: unknown) => {
    if (q.includes('"internalTagList"')) {
      const d = lists.get(p.listId as string)
      return d && d.projectSlug === p.projectSlug ? (d.tags ?? null) : null
    }
    return realFetch(q, p, o)
  })
  const realTx = client.transaction
  const listCommits: Op[][] = []
  client.transaction = vi.fn(() => {
    const inner = realTx ? realTx() : null
    const ops: Op[] = []
    const t = {
      createIfNotExists: (doc: { _id: string; projectSlug: string; scope: string; tags: string[] }) => (ops.push({ kind: 'create', doc }), t),
      patch: (id: string, v: Record<string, unknown>) => {
        if (id.startsWith('internalTagList.')) ops.push({ kind: 'patch', id, ops: v })
        else inner?.patch(id, v)
        return t
      },
      create: (d: unknown) => (inner?.create?.(d), t),
      delete: (id: string) => (inner?.delete?.(id), t),
      commit: async () => {
        const r = inner ? await inner.commit() : {}
        if (ops.length && opts.failListCommit) throw Object.assign(new Error('list'), { statusCode: 500 })
        for (const op of ops) {
          if (op.kind === 'create') {
            if (!lists.has(op.doc._id)) lists.set(op.doc._id, { projectSlug: op.doc.projectSlug, scope: op.doc.scope, tags: [...op.doc.tags] })
          } else {
            const d = lists.get(op.id)!
            if ('setIfMissing' in op.ops && !d.tags) d.tags = []
            const ins = op.ops.insert as { after: string; items: string[] } | undefined
            if (ins) d.tags = [...(d.tags ?? []), ...ins.items]
          }
        }
        if (ops.length) listCommits.push(ops)
        return r
      },
    }
    return t
  })
  return { lists, listCommits }
}
