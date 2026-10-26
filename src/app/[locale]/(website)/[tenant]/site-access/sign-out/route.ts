/**
 * ADR-040 B2.3 — "Sign out" posts here. All logic, and the security checks,
 * live in src/lib/access/visitor-routes.ts (route-level tests:
 * src/lib/access/__tests__/visitor-routes.test.ts).
 */
import type { NextRequest } from 'next/server'
import { handleSignOut } from '@/lib/access/visitor-routes'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ locale: string; tenant: string }> }) {
  return handleSignOut(request, await params)
}
