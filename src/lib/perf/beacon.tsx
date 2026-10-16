import { PerfBeacon } from '@/components/perf/PerfBeacon'
import { currentPerf } from './timing'

/**
 * Server helper: `{perfBeacon()}` at the end of a traced page / layout. Returns
 * null unless perf is enabled (never in production) and a trace is open, so
 * production markup is unchanged. The numbers are those measured up to the
 * moment of the call (data loading); React's own render time is not included.
 */
export function perfBeacon() {
  const report = currentPerf()
  return report ? <PerfBeacon report={report} /> : null
}
