'use client'

import { useEffect } from 'react'
import type { PerfReport } from '@/lib/perf/timing'

/**
 * Prints a server render's timings to the browser console (PERF-2). Rendered
 * only by `perfBeacon()` (server side), i.e. never in production; renders
 * nothing. The report is op name, outcome and millisecond counts only.
 */
export function PerfBeacon({ report }: { report: PerfReport }) {
  useEffect(() => {
    try {
      console.info('[perf]', `${report.op} server=${report.ms}ms outcome=${report.outcome}`, report.spans)
    } catch {
      /* ignore */
    }
  }, [report])
  return null
}
