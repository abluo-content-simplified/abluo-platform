'use client'

import { useEffect, useState } from 'react'
import { StringInputProps } from 'sanity'

/**
 * Custom input component for projectSlug field
 * Currently a read-only display component while we debug template execution
 */
export function ProjectSlugInput(props: StringInputProps) {
  const { value, onChange } = props
  const [debugInfo, setDebugInfo] = useState<any>(null)
  const extractedSlug = value

  useEffect(() => {
    console.log('[TRACE STEP 5A] ProjectSlugInput component mounted/updated')
    console.log('[TRACE STEP 5B] Current field value:', { value, isDefined: value !== undefined })
    console.log('[TRACE STEP 5C] Props received:', props)
    console.log('[TRACE STEP 5D] onChange function:', typeof onChange)

    setDebugInfo({ value, receivedProps: !!props })
  }, [value, onChange, props])

  return (
    <div>
      <input
        type="text"
        value={value || ''}
        readOnly
        disabled
        style={{
          padding: '8px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          backgroundColor: '#f5f5f5',
          fontFamily: 'monospace',
        }}
        placeholder="Project slug (auto-filled)"
      />
      {extractedSlug && (
        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
          Auto-filled from project: <strong>{extractedSlug}</strong>
        </div>
      )}
      {!extractedSlug && (
        <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
          Could not extract project slug from URL
        </div>
      )}
    </div>
  )
}
