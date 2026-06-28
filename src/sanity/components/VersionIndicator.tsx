'use client'

import { useEffect, useState } from 'react'

interface VersionInfo {
  platformVersion: string
  engineeringVersion: string
  releaseName: string
  commit: string
  commitLong: string
  branch: string
  environment: string
  buildDate: string
  dataset: string
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

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-40 flex flex-col items-start gap-0.5 px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors cursor-pointer font-mono leading-tight"
        title="Click to see version details"
      >
        <span>
          <span className="text-gray-500">Platform</span> {versionInfo.platformVersion}
        </span>
        <span className="text-[10px] text-gray-500">
          Engineering {versionInfo.engineeringVersion} • {versionInfo.commit}
        </span>
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
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase">Platform Version</p>
                <p className="text-sm font-mono mt-1">{versionInfo.platformVersion}</p>
                <p className="text-xs text-gray-500">customer-facing milestone</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase">Engineering Version</p>
                <p className="text-sm font-mono mt-1">{versionInfo.engineeringVersion}</p>
                {versionInfo.releaseName ? (
                  <p className="text-xs text-gray-500">{versionInfo.releaseName}</p>
                ) : (
                  <p className="text-xs text-gray-500">developer-facing iteration</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase">Commit</p>
                <p className="text-sm font-mono mt-1">{versionInfo.commitLong}</p>
                <p className="text-xs text-gray-500">(short: {versionInfo.commit})</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase">Environment</p>
                <p className="text-sm mt-1">{versionInfo.environment}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase">Branch</p>
                <p className="text-sm font-mono mt-1">{versionInfo.branch}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase">Dataset</p>
                <p className="text-sm font-mono mt-1">{versionInfo.dataset}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase">Build Date</p>
                <p className="text-sm mt-1">{versionInfo.buildDate}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
