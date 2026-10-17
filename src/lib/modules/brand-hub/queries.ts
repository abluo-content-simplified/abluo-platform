// ── Brand Hub — delivery query (ADR-036) ──────────────────────────────────────
//
// ONE query for everything the hub needs that is not the resolved design system
// (which comes through designSystemQuery + resolveDesignSystemInheritance, the
// same path the website layout uses — never a second projection of DS fields).
//
// Every root filter carries projectSlug == $projectSlug. Text is resolved
// requested locale → site default → en, like every website query.

const loc = (field: string) =>
  `coalesce(${field}[$locale], ${field}[$defaultLocale], ${field}.en, select(!defined(${field}._type) => ${field}))`

/** An image/file asset with what the Logo page needs to describe and download it. */
const assetMeta = (field: string) => /* groq */ `
  ${field}.asset->{
    url,
    originalFilename,
    extension,
    mimeType,
    size,
    "width": metadata.dimensions.width,
    "height": metadata.dimensions.height
  }`

const page = (field: string) => /* groq */ `
  "${field}": {
    "status": ${field}.status,
    "body": ${loc(`${field}.body`)},
    "doDont": ${field}.doDont[]{
      _key,
      kind,
      "imageUrl": mediaAsset->image.asset->url,
      "caption": ${loc('caption')}
    }
  }`

/** A statement or rule: its text in the requested language, and its status. */
const statement = (path: string, key: string) => /* groq */ `
  "${key}": select(defined(${path}) => { "text": ${loc(`${path}.text`)}, "status": ${path}.status })`

const STATEMENTS = ['mission', 'vision', 'promise', 'audience', 'positioning', 'personality', 'values', 'story']
const LOGO_RULES = ['clearSpace', 'minimumDigital', 'minimumPrint', 'backgrounds']

export const brandHubQuery = /* groq */ `{
  "guide": *[_type == "brandGuide" && projectSlug == $projectSlug] | order(_updatedAt desc)[0]{
    _updatedAt,
    version,
    status,
    "intro": ${loc('intro')},
    "statements": {${STATEMENTS.map((k) => statement(k, k)).join(',')}
    },
    "howToUse": ${loc('howToUse')},
    "changes": changes[]{ _key, date, "note": ${loc('note')} },
    "logoRules": {${LOGO_RULES.map((k) => statement(`logoRules.${k}`, k)).join(',')}
    },
    ${page('colour')},
    ${page('typography')},
    ${page('shape')},
    ${page('layout')},
    ${page('logo')},
    ${page('motion')},
    ${page('voice')}
  },
  "site": *[_type == "siteConfig" && projectSlug == $projectSlug][0]{
    _updatedAt,
    siteName,
    timeZone,
    "logo": ${assetMeta('logo')},
    "logoLight": ${assetMeta('logoLight')},
    "faviconSvg": ${assetMeta('faviconSvg')},
    "faviconPng": ${assetMeta('faviconPng')},
    "openGraphImage": ${assetMeta('openGraphImage')}
  },
  // The design system document(s) — timestamps and background graphics only.
  // The values themselves come from the resolved design system.
  "ds": coalesce(
    *[_type == "project" && projectSlug == $projectSlug][0].designSystemRef->,
    *[_type == "designSystem" && projectSlug == $projectSlug][0]
  ){
    _updatedAt,
    "parentUpdatedAt": parentDesignSystem->_updatedAt,
    "grandparentUpdatedAt": parentDesignSystem->parentDesignSystem->_updatedAt,
    "backgroundAssets": backgroundAssets[]{
      key,
      name,
      "light": ${assetMeta('lightImage')},
      "dark": ${assetMeta('darkImage')}
    }
  }
}`

export interface BrandHubAssetMeta {
  url?: string | null
  originalFilename?: string | null
  extension?: string | null
  mimeType?: string | null
  size?: number | null
  width?: number | null
  height?: number | null
}

export interface BrandHubStatementRow {
  text?: string | null
  status?: string | null
}

export interface BrandHubGuidePageRow {
  status?: string | null
  body?: unknown[] | null
  doDont?: { _key: string; kind?: string | null; imageUrl?: string | null; caption?: string | null }[] | null
}

export interface BrandHubQueryResult {
  guide: ({
    _updatedAt?: string
    version?: number | null
    status?: string | null
    intro?: unknown[] | null
    statements?: Record<string, BrandHubStatementRow | null> | null
    howToUse?: unknown[] | null
    changes?: { _key: string; date?: string | null; note?: string | null }[] | null
    logoRules?: Record<string, BrandHubStatementRow | null> | null
  } & Partial<Record<'colour' | 'typography' | 'shape' | 'layout' | 'logo' | 'motion' | 'voice', BrandHubGuidePageRow | null>>) | null
  site: {
    _updatedAt?: string
    siteName?: string | null
    timeZone?: string | null
    logo?: BrandHubAssetMeta | null
    logoLight?: BrandHubAssetMeta | null
    faviconSvg?: BrandHubAssetMeta | null
    faviconPng?: BrandHubAssetMeta | null
    openGraphImage?: BrandHubAssetMeta | null
  } | null
  ds: {
    _updatedAt?: string
    parentUpdatedAt?: string | null
    grandparentUpdatedAt?: string | null
    backgroundAssets?: { key?: string | null; name?: string | null; light?: BrandHubAssetMeta | null; dark?: BrandHubAssetMeta | null }[] | null
  } | null
}
