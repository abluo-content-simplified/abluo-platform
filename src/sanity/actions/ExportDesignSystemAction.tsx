import { useState } from 'react'
import { DocumentActionProps, DocumentActionComponent, useClient } from 'sanity'
import { DownloadIcon } from '@sanity/icons'
import { buildExportPayload, downloadJson, exportFilename } from './designSystemUtils'

export const ExportDesignSystemAction: DocumentActionComponent = (
  props: DocumentActionProps
) => {
  const { id, draft, published } = props
  const client = useClient({ apiVersion: '2026-05-21' })
  const [isExporting, setIsExporting] = useState(false)

  const doc = draft ?? published

  return {
    label: isExporting ? 'Exporting…' : 'Export JSON',
    icon: DownloadIcon,
    disabled: !doc || isExporting,
    onHandle: async () => {
      setIsExporting(true)
      try {
        // Fetch fresh from Sanity to ensure we have the complete document,
        // including any fields not yet reflected in the Studio's local state.
        const fresh = (await client.getDocument(id)) as Record<string, unknown> | null
        const source = fresh ?? (doc as Record<string, unknown>)
        const payload = buildExportPayload(source)
        downloadJson(payload, exportFilename(source))
      } finally {
        setIsExporting(false)
      }
    },
  }
}
