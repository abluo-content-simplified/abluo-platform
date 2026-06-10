'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface VersionInfo {
  version: string
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
        className="fixed bottom-4 right-4 z-40 px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors cursor-pointer"
        title="Click to see version details"
      >
        Abluo CMS v{versionInfo.version} • {versionInfo.commit}
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abluo CMS Version Info</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-600">Version</p>
              <p className="text-sm font-mono">{versionInfo.version}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Commit</p>
              <p className="text-sm font-mono">{versionInfo.commitLong}</p>
              <p className="text-xs text-gray-500">(short: {versionInfo.commit})</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Environment</p>
              <p className="text-sm">{versionInfo.environment}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Branch</p>
              <p className="text-sm font-mono">{versionInfo.branch}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Dataset</p>
              <p className="text-sm font-mono">{versionInfo.dataset}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Build Date</p>
              <p className="text-sm">{versionInfo.buildDate}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
