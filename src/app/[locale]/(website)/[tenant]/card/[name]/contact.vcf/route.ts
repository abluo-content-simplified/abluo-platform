/** GET /card/<name>/contact.vcf — a person card's Save contact (ADR-049 D9). See vcard-route.server.ts. */
import { serveCardVCard } from '@/lib/modules/digital-cards/vcard-route.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ tenant: string; locale: string; name: string }> }) {
  const { tenant, locale, name } = await params
  return serveCardVCard(request, { tenant, locale, name })
}
