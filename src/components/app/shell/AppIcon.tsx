/**
 * The one icon drawing of the Abluo App shell: a single Lucide-style stroke
 * path (24×24 grid, round caps). Icons are path strings rather than an icon
 * library, so a nav item or tab is plain data that can come from a server
 * component or a registry (ADR-030). Decorative only — the label next to it,
 * or the control's aria-label, carries the meaning.
 */
export function AppIcon({ d, size = 24, width = 1.8 }: { d: string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** Shell-level icons that more than one surface draws. Surface-specific ones stay with the surface. */
export const APP_ICONS = {
  /** Notification Center (ADR-050 D10). */
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  /** Messages (ADR-050). */
  messages: 'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1zM8 9h8M8 13h5',
  /** A file (PDF attachment). */
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  media: 'M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  // Support (life buoy): the client's Support page and the admin's Support Tickets.
  support: 'M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M4.93 19.07l4.24-4.24',
  generic: 'M4 6h16M4 12h16M4 18h10',
} as const
