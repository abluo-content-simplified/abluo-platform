/**
 * ADR-040 §15 (R9) — the members bar asks whether this browser is signed in.
 * All logic lives in src/lib/access/visitor-routes.ts (handleStatus).
 */
import type { NextRequest } from 'next/server'
import { handleStatus } from '@/lib/access/visitor-routes'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string; tenant: string }> }) {
  return handleStatus(request, await params)
}
