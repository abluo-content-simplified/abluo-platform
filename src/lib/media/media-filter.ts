/**
 * Parameterized GROQ filter builder for the media browser API.
 *
 * The media list/tags endpoints previously built their GROQ `filter` string by
 * directly interpolating request params (`tenant`, `project`, `tags`,
 * `search`) into the query — a GROQ-injection surface (ADR-015 R2: no
 * raw/interpolated query strings). This helper produces a filter that
 * references GROQ parameters only ($tenant, $project, $tags, $search); the
 * caller passes `params` to `client.fetch(query, params)` so user input is
 * never concatenated into the query text.
 *
 * The clause *semantics* are preserved exactly from the original interpolated
 * form so the endpoints' behaviour (and response shape) is unchanged.
 */

export interface MediaFilterInput {
  tenant?: string | null
  project?: string | null
  /** Already split/filtered list of tag strings (may be empty). */
  tags?: string[]
  /** Free-text search string (empty string means "no search"). */
  search?: string
}

export interface MediaFilterResult {
  /** GROQ boolean expression using only literals and $-parameters. */
  filter: string
  /** Values to pass as the second argument to `client.fetch`. */
  params: Record<string, unknown>
}

/**
 * Build a parameterized GROQ filter + params for `mediaAsset` documents.
 *
 * Equivalent to the previous interpolated clauses:
 *   tenant   → `tenant._ref == $tenant`
 *   project  → `project._ref == $project`
 *   tags     → any-of match, via `count(tags[@ in $tags]) > 0`
 *   search   → text match across altText / description / filename / tags
 */
export function buildMediaFilter(input: MediaFilterInput): MediaFilterResult {
  const clauses: string[] = ['_type == "mediaAsset"']
  const params: Record<string, unknown> = {}

  if (input.tenant) {
    clauses.push('tenant._ref == $tenant')
    params.tenant = input.tenant
  }

  if (input.project) {
    clauses.push('project._ref == $project')
    params.project = input.project
  }

  if (input.tags && input.tags.length > 0) {
    // Original: (`"a" in tags` || `"b" in tags`). Equivalent any-of match
    // without interpolating each tag: keep the doc's tags that appear in the
    // requested set; a non-empty intersection means a match.
    clauses.push('count(tags[@ in $tags]) > 0')
    params.tags = input.tags
  }

  if (input.search) {
    clauses.push(
      '(altText match $search || description match $search || image.asset->originalFilename match $search || tags[] match $search)'
    )
    params.search = input.search
  }

  return { filter: clauses.join(' && '), params }
}
