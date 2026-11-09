/** The Digital Card editor's tabs (ADR-049 Amendment A). `?tab=share|stats` opens one directly — the Analytics page links each card to its Statistics. Not in the 'use client' file: the server page reads it. */
export const DIGITAL_CARD_EDITOR_TABS = ['card', 'share', 'stats'] as const
export type EditorTab = (typeof DIGITAL_CARD_EDITOR_TABS)[number]

/** The editor's address with a tab open. */
export function digitalCardEditorHref(projectSlug: string, id: string, tab?: EditorTab): string {
  return `/${projectSlug}/cards/${encodeURIComponent(id)}${tab && tab !== 'card' ? `?tab=${tab}` : ''}`
}
