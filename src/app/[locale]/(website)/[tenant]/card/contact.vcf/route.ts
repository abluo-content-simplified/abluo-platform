/** GET /card/contact.vcf — the site card's Save contact (ADR-049 D9). See vcard-route.server.ts. */
import { serveCardVCard } from '@/lib/modules/digital-cards/vcard-route.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ tenant: string; locale: string }> }) {
  const { tenant, locale } = await params
  return serveCardVCard(request, { tenant, locale })
}
