/**
 * Handles bare project slug URLs: /studiomartegani → /it/studiomartegani
 *
 * This route exists to replace any CDN-cached 404 for /{slug} with a proper
 * redirect. Without this, Vercel's project-level CDN cache keeps serving
 * stale 404s for slug paths even after middleware fixes.
 *
 * Only known project slugs are handled — unknown paths fall through to 404.
 */
import { redirect, notFound } from 'next/navigation'

const PROJECT_LOCALES: Record<string, string> = {
  studiomartegani: 'it',
  livener: 'it',
}

interface Props {
  params: Promise<{ slug: string }>
}

export default async function SlugRedirectPage({ params }: Props) {
  const { slug } = await params
  const locale = PROJECT_LOCALES[slug]

  if (!locale) {
    notFound()
  }

  redirect(`/${locale}/${slug}`)
}
