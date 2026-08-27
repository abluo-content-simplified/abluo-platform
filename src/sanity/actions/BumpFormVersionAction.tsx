'use client'

import { useState } from 'react'
import { DocumentActionComponent, DocumentActionProps, useDocumentOperation } from 'sanity'
import { PublishIcon } from '@sanity/icons'
import { nextVersion, type VersionableForm } from '@/lib/modules/forms/version'

/**
 * BumpFormVersionAction
 *
 * Replaces the built-in Publish action on `formDefinition` documents.
 *
 * On publish it sets `version` to whatever the published history says it should
 * be — published + 1 when the draft changes the shape of the data, unchanged
 * when the edit was presentation only, 1 for a form being published for the
 * first time. See src/lib/modules/forms/version.ts for what counts as a change
 * and why.
 *
 * The field is read-only in the Studio form, so this action is the only writer.
 * That is the point: `version` is pinned onto every submission as
 * `form_version`, and a number an editor can type is a number that will
 * eventually be wrong — either forgotten after a real change, or nudged by
 * someone who assumed it was a label they owned.
 *
 * Monotonicity does not depend on the draft: the new value is derived from the
 * published document, so a stale or hand-edited draft value cannot lower it.
 */
export const BumpFormVersionAction: DocumentActionComponent = (
  props: DocumentActionProps
) => {
  const { id, type, draft, published, onComplete } = props
  const { publish, patch } = useDocumentOperation(id, type)
  const [busy, setBusy] = useState(false)

  const target = nextVersion(
    published as VersionableForm | null,
    draft as VersionableForm | null
  )
  const current = (draft?.version ?? published?.version) as number | undefined
  const willBump = current !== target

  return {
    label: busy ? 'Publishing…' : willBump ? `Publish (v${target})` : 'Publish',
    icon: PublishIcon,
    // Mirrors the built-in Publish action's disabled logic.
    disabled: !draft || !!publish.disabled || busy,
    tone: 'positive',
    onHandle: async () => {
      setBusy(true)
      try {
        // Patch before publishing so the version travels with this revision
        // rather than landing as a separate edit after it.
        if (willBump) {
          patch.execute([{ set: { version: target } }])
        }
        publish.execute()
      } finally {
        setBusy(false)
        onComplete()
      }
    },
  }
}
