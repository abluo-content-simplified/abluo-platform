/**
 * Serialises a value for an inline `<script type="application/ld+json">` (or
 * any other inline JSON script) rendered with `dangerouslySetInnerHTML`.
 *
 * `JSON.stringify` alone is NOT safe there: it leaves `<`, `>` and `&` as is,
 * so a string such as `</script><script>…` — e.g. a blog post title written
 * from the client dashboard — closes the script element and injects markup.
 * Escaping them (and U+2028 / U+2029, which old JS parsers treat as line
 * terminators) as `\uXXXX` keeps the payload byte-for-byte equivalent JSON:
 * `JSON.parse(safeJsonLd(x))` deep-equals `x`.
 *
 * Every inline-JSON emitter in src/ must use this (see
 * src/components/__tests__/safe-json-ld.test.tsx).
 */
export function safeJsonLd(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
