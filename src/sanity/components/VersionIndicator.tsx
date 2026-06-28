'use client'

import { useEffect, useState } from 'react'

interface VersionInfo {
  platformVersion: string
  releaseTitle: string
  commit: string
  commitLong: string
  branch: string
  environment: string
  buildDate: string
  dataset: string
}

// Format an ISO timestamp in the viewer's LOCAL timezone (never raw GMT).
// e.g. "28 Jun 2026, 17:42"
function formatBuilt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function VersionIndicator() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchVersionInfo = async () => {
      try {
        const response = await fetch('/api/version')
        if (response.ok) {
          const data = await response.json()
          setVersionInfo(data)
        }
      } catch (error) {
        console.error('Failed to fetch version info:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchVersionInfo()
  }, [])

  if (isLoading || !versionInfo) {
    return null
  }

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Platform Version', value: versionInfo.platformVersion, mono: true },
    ...(versionInfo.releaseTitle ? [{ label: 'Release', value: versionInfo.releaseTitle }] : []),
    { label: 'Commit', value: versionInfo.commit, mono: true },
    { label: 'Environment', value: versionInfo.environment },
    { label: 'Branch', value: versionInfo.branch, mono: true },
    { label: 'Dataset', value: versionInfo.dataset, mono: true },
    { label: 'Built', value: formatBuilt(versionInfo.buildDate) },
  ]

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-40 px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors cursor-pointer font-mono"
        title="Click to see version details"
      >
        Abluo CMS {versionInfo.platformVersion} • {versionInfo.commit}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Abluo CMS Version Info</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              {rows.map((row) => (
                <div key={row.label}>
                  <p className="text-xs font-semibold text-gray-600 uppercase">{row.label}</p>
                  <p className={`text-sm mt-1${row.mono ? ' font-mono' : ''}`}>{row.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
