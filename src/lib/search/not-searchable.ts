/**
 * Modules that have a dashboard "create" entry point but are NOT searched in
 * v1 (ADR-047 D3 / D4). The guard test requires every module with a
 * `createAction` to declare `search` or appear here with an honest reason.
 * Remove the entry when the module gains a `search` block.
 */
export const NOT_SEARCHABLE: Record<string, string> = {
  news: 'v1.1 candidate: ADR-047 D3 lists News among the modules to add by declaring fields; its create action is not built yet.',
  gallery: 'v1.1 candidate: galleries are found through their photos in the Media Library for now (ADR-047 D3).',
  faq: 'v1.1 candidate: FAQ sets are small and reached from the posts they are attached to (ADR-047 D3).',
  documents: 'Waits for Access Management: documents live in Supabase behind private areas and need their own access rules (ADR-047 D3).',
  live: 'v1.1 candidate: live entries are time-bound and not part of the v1 field list (ADR-047 D3).',
}
