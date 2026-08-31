/**
 * Browser-safe Sanity connection config.
 *
 * This module contains ONLY values that are already public: the project id and
 * the dataset name are both `NEXT_PUBLIC_*` and are visible in the browser
 * today. It deliberately contains no token and imports nothing, so it is safe
 * to pull into a client component bundle.
 *
 * It exists so that browser-side consumers (notably the `@sanity/image-url`
 * builder in `src/lib/sanity/image.ts`) can be configured WITHOUT importing
 * `src/lib/sanity/client.ts`, which — once `SANITY_API_READ_TOKEN` is set —
 * constructs a client carrying a server-only secret.
 *
 * See `docs/engineering/sanity-private-dataset.md`.
 */

export const SANITY_PROJECT_ID = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3'
export const SANITY_DATASET = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
export const SANITY_API_VERSION = '2026-05-21'
