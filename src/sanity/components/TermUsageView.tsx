'use client'

import { useEffect, useState } from 'react'
import { useClient } from 'sanity'
import type { UserViewComponent } from 'sanity/structure'
import { MODULE_REGISTRY } from '@/lib/modules'
import { summarizeUsage, type UsageRow } from '@/lib/taxonomy/usage'
import { usageQueryForTerm } from '@/lib/taxonomy/studio'

/** Read-only "Used by N items" tab on a taxonomyTerm. Information only — never blocks anything. */
export const TermUsageView: UserViewComponent = ({ document }) => {
  const client = useClient({ apiVersion: '2026-05-21' }).withConfig({ perspective: 'raw' })
  const term = (document.displayed ?? {}) as { projectSlug?: string; module?: string; kind?: string; key?: string }
  const [text, setText] = useState('Loading…')
  const q = usageQueryForTerm(MODULE_REGISTRY, term)
  const tracked = Boolean(q && term.projectSlug)

  useEffect(() => {
    if (!q) return
    client
      .fetch<UsageRow[]>(q.query, { ...q.params, projectSlug: term.projectSlug })
      .then((rows) => {
        const { count } = summarizeUsage(rows)
        setText(count === 0 ? 'Not used by any item.' : `Used by ${count} item${count === 1 ? '' : 's'}.`)
      })
      .catch(() => setText('Could not load usage.'))
  }, [client, term.projectSlug, term.module, term.kind, term.key]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div style={{ padding: 24, fontSize: 14 }}>{tracked ? text : 'Usage is not tracked for this kind of term.'}</div>
}
