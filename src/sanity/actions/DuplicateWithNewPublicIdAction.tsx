import { useCallback, useState } from 'react'
import { type DocumentActionComponent, type DocumentActionProps, useClient } from 'sanity'
import { useRouter } from 'sanity/router'
import { CopyIcon } from '@sanity/icons'
import { duplicateDocumentBody } from './duplicate-with-new-public-id'

/**
 * Replaces the built-in Duplicate on every type with a `publicId` field
 * (event, eventVenue, catalogue types): same copy, new publicId (ADR-038 D2).
 * The copy is created as a draft and opened, like the built-in action.
 */
export const DuplicateWithNewPublicIdAction: DocumentActionComponent = (props: DocumentActionProps) => {
  const { draft, published, type } = props
  const client = useClient({ apiVersion: '2026-05-21' })
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const source = (draft ?? published) as Record<string, unknown> | null

  const onHandle = useCallback(async () => {
    if (!source || busy) return
    setBusy(true)
    try {
      const id = globalThis.crypto.randomUUID()
      const body = duplicateDocumentBody(source, globalThis.crypto.randomUUID())
      await client.create({ ...body, _id: `drafts.${id}`, _type: type })
      router.navigateIntent('edit', { id, type })
    } finally {
      setBusy(false)
      props.onComplete()
    }
  }, [source, busy, client, router, type, props])

  return {
    label: busy ? 'Duplicating…' : 'Duplicate',
    icon: CopyIcon,
    disabled: !source || busy,
    title: 'Make a copy with its own Public ID',
    onHandle,
  }
}
