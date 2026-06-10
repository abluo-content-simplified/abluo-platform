// ─── Background Asset Resolution ──────────────────────────────────────────────
// Resolves background assets from design system by key, with light/dark variants

export interface BackgroundAsset {
  key: string
  name: string
  lightImage?: {
    asset?: {
      url: string
    }
  }
  darkImage?: {
    asset?: {
      url: string
    }
  }
}

export interface DesignSystemWithAssets {
  backgroundAssets?: BackgroundAsset[]
}

/**
 * Resolve a background asset by key from design system
 * Returns light OR dark variant URL based on theme preference
 * Falls back to light variant if dark not available
 * Returns null if asset not found
 */
export function getBackgroundAssetUrl(
  designSystem: DesignSystemWithAssets | null | undefined,
  assetKey: string,
  theme: 'light' | 'dark' = 'light'
): string | null {
  if (!designSystem?.backgroundAssets) {
    return null
  }

  const asset = designSystem.backgroundAssets.find((a) => a.key === assetKey)
  if (!asset) {
    return null
  }

  // Prefer requested theme, fall back to light
  if (theme === 'dark' && asset.darkImage?.asset?.url) {
    return asset.darkImage.asset.url
  }

  if (asset.lightImage?.asset?.url) {
    return asset.lightImage.asset.url
  }

  // Last resort: return dark if light isn't available
  if (asset.darkImage?.asset?.url) {
    return asset.darkImage.asset.url
  }

  return null
}

/**
 * Get both light and dark variants for an asset
 * Useful for CSS variables or theme switching
 */
export function getBackgroundAssetPair(
  designSystem: DesignSystemWithAssets | null | undefined,
  assetKey: string
): { light: string | null; dark: string | null } {
  if (!designSystem?.backgroundAssets) {
    return { light: null, dark: null }
  }

  const asset = designSystem.backgroundAssets.find((a) => a.key === assetKey)
  if (!asset) {
    return { light: null, dark: null }
  }

  return {
    light: asset.lightImage?.asset?.url ?? null,
    dark: asset.darkImage?.asset?.url ?? null,
  }
}
