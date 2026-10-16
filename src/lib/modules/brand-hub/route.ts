// Brand Hub route constants (ADR-036 D1/D5). Kept out of the page file so tests
// can import them without loading Next.js server modules.

/** Registry id — kebab-case (validate.ts Rule 2). */
export const BRAND_HUB_MODULE_ID = 'brand-hub'

/** URL segment under the site base. Reserved in DEFAULT_RESERVED_SEGMENTS. */
export const BRAND_HUB_SEGMENT = 'brand'

/** D5 — every hub page, every environment. */
export const BRAND_HUB_ROBOTS = { index: false, follow: false } as const
