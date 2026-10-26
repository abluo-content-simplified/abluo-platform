/**
 * ADR-040 B2.4 — a protected PDF at a stable address on the site itself.
 * Every request (each byte range included) re-checks the visitor. Logic:
 * src/lib/access/document-route.ts + delivery.ts.
 */
import type { NextRequest } from 'next/server'
import { handleDocument } from '@/lib/access/document-route'

export const dynamic = 'force-dynamic'
// Streaming a 20 MB PDF to a slow connection: well inside the 300 s default
// of Vercel Functions (Fluid compute); set explicitly so it is visible.
export const maxDuration = 300

type Ctx = { params: Promise<{ locale: string; tenant: string; documentId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  return handleDocument(request, await params)
}

export async function HEAD(request: NextRequest, { params }: Ctx) {
  return handleDocument(request, await params)
}
