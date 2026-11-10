/**
 * QR code colours — pure black on pure white, always, in both themes.
 * Artwork, not interface: scanners need maximum contrast, so these are not
 * design-system tokens. One definition for the dashboard Share tab and the
 * public card's QR button.
 */
export const QR_COLORS = { dark: '#000000ff', light: '#ffffffff' } as const
