'use client'

import { Suspense, lazy, type ComponentType } from 'react'
import { LAB_REGISTRY } from '@/lab/registry'
import { DemoCanvas } from './DemoCanvas'

/**
 * One lazy component per entry, created once at module level (never during
 * render). Each wraps the registry's dynamic import, so a demo's code only
 * loads when its page is opened.
 */
const DEMOS: Record<string, ComponentType> = Object.fromEntries(LAB_REGISTRY.map((e) => [e.id, lazy(e.demo)]))

export function LabDemo({ id }: { id: string }) {
  const Demo = DEMOS[id]
  if (!Demo) return null
  return (
    <DemoCanvas>
      <Suspense fallback={<div className="h-24" />}>
        <Demo />
      </Suspense>
    </DemoCanvas>
  )
}
