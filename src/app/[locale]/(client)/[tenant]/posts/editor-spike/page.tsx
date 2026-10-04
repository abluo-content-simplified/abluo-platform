import { notFound } from 'next/navigation'
import { EditorSpike } from '@/components/client/editor/EditorSpike'

/**
 * S0d — body editor spike (ADR-025 D6). Developer tool for testing the
 * Portable Text editor on real phones before S3 builds on it.
 *
 * Lives under `posts/` so the existing client-surface gate (`posts` is in
 * CLIENT_PROJECT_SEGMENTS) and the project layout's grant check already apply.
 * It 404s in production; delete this route once S3's "Tell your story" ships.
 */
export default function EditorSpikePage() {
  if (process.env.VERCEL_ENV === 'production') notFound()
  return <EditorSpike />
}
