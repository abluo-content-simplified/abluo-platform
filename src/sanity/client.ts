/**
 * Compatibility barrel — use `@/lib/sanity/client` in new files.
 *
 * This was `export * from '@/lib/sanity/client'`, which silently re-exported
 * the raw `sanityClient`. That created a second, invisible spelling of the
 * unscoped client: `no-restricted-imports` in `eslint.config.mjs` only guards
 * the `@/lib/sanity/client` path, so anything importing `sanityClient` from
 * here bypassed both the project-scoping guard and (once
 * `SANITY_API_READ_TOKEN` is set) the reasoning about which modules may carry
 * a server-only secret.
 *
 * It is now an explicit allow-list that deliberately EXCLUDES `sanityClient`.
 * Verified at the time of writing: nothing in the repo imports from
 * `@/sanity/client`, so narrowing it breaks no consumer. Code that genuinely
 * needs the raw client must import it from `@/lib/sanity/client` and take the
 * lint warning, which is the point.
 */
export {
  tenantClient,
  fetchDesignSystemById,
  hasSanityReadToken,
} from '@/lib/sanity/client'

// `isKnownProjectSegment` used to be re-exported here. RENAME.md Step 6 moved
// it to `@/lib/tenancy/host-scope`, where it is derived from the generated
// route table rather than hand-typed. It is a TENANCY concern, not a Sanity
// one, so it is deliberately not re-exported through a Sanity barrel — import
// it from `@/lib/tenancy/host-scope`.
