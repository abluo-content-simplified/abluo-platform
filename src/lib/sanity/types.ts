// ─── Localized primitives ──────────────────────────────────────────────────────
// GROQ resolves these before they reach the frontend — components receive plain
// strings/arrays. These raw types are only used if you query the unresolved document.

// SupportedLocale is derived from the Platform Locale Registry.
// To add a new language, edit src/lib/i18n/locales.ts — not this file.
import type { SupportedLocale as _SupportedLocale } from '@/lib/i18n/locales'
export type { SupportedLocale } from '@/lib/i18n/locales'
// Local alias so references later in this file resolve correctly.
type SupportedLocale = _SupportedLocale

// LocalizedString covers all platform-supported languages.
// Tenants only fill the fields matching their siteConfig.supportedLocales;
// all other fields are left empty and ignored by GROQ queries.
export interface LocalizedString {
  en?: string
  it?: string
  de?: string
  fr?: string
  es?: string
  pt?: string
  nl?: string
}

// ─── Portable Text ────────────────────────────────────────────────────────────

export interface PortableTextSpan {
  _type: 'span'
  _key: string
  marks: string[]
  text: string
}

export interface PortableTextBlock {
  _type: 'block'
  _key: string
  style: string
  listItem?: string
  level?: number
  markDefs: unknown[]
  children: PortableTextSpan[]
}

export type PortableTextContent = PortableTextBlock[]

// ─── Sanity Image ─────────────────────────────────────────────────────────────

export interface SanityImageAsset {
  _ref: string
  _type: 'reference'
}

export interface SanityHotspot {
  x: number
  y: number
  height: number
  width: number
}

export interface SanityCrop {
  top: number
  bottom: number
  left: number
  right: number
}

// Raw Sanity image (unresolved)
export interface SanityImage {
  _type: 'image'
  asset: SanityImageAsset
  hotspot?: SanityHotspot
  crop?: SanityCrop
}

// Resolved localized image (after GROQ projection)
export interface ResolvedImage {
  asset: SanityImageAsset
  hotspot?: SanityHotspot
  crop?: SanityCrop
  alt?: string
  caption?: string
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

/**
 * Raw CTA object as returned from Sanity via CTA_FIELDS projection.
 * The GROQ query resolves pageSlug and fileUrl so the frontend never
 * needs to dereference Sanity references at runtime.
 */
export interface Cta {
  label?: string
  internalName: string
  actionType?: 'page' | 'form' | 'fileDownload' | 'externalUrl'
  /** Resolved slug of the target page — locale+tenant prefix added at render time. */
  pageSlug?: string
  // Resolved from formRef by GROQ
  formId?: string
  formInquiryType?: string
  // Resolved from file.asset by GROQ
  fileUrl?: string
  fileName?: string
  // External URL fields
  externalUrl?: string
  openInNewTab?: boolean
}

/**
 * Discriminated union returned by resolveCta().
 * The consuming component switches on `type` to render the right element.
 */
export type ResolvedCta =
  | {
      type: 'link'
      label: string
      internalName: string
      href: string
      external: boolean
    }
  | {
      type: 'download'
      label: string
      internalName: string
      href: string
      fileName?: string
    }
  | {
      type: 'form'
      label: string
      internalName: string
      formId: string
      formInquiryType?: string
    }
  | {
      type: 'none'
      label: string
      internalName: string
    }

// ─── Navigation ───────────────────────────────────────────────────────────────

export interface NavLink {
  label: string
  linkType?: 'internal' | 'external'
  // Resolved slug from pageRef — set by GROQ query, not stored directly
  pageSlug?: string
  internalPage?: 'homepage' | 'live' | 'events'
  externalUrl?: string
  openInNewTab?: boolean
  // Legacy fields for backward compatibility
  href?: string
  external?: boolean
  children?: NavLink[]
}

// Helper type for resolved links (after URL computation)
export interface ResolvedNavLink {
  label: string
  href: string
  external: boolean
  children?: ResolvedNavLink[]
}

export interface SocialLink {
  platform: 'youtube' | 'instagram' | 'linkedin' | 'facebook' | 'x' | 'tiktok' | 'threads'
  url: string
}

// ─── Design System ────────────────────────────────────────────────────────────

export interface ColorTheme {
  background?: string
  backgroundAlt?: string
  surface?: string
  primary?: string
  secondary?: string
  accent?: string
  textPrimary?: string
  textSecondary?: string
  textMuted?: string
  border?: string
  success?: string
  warning?: string
  danger?: string
}

export interface FontDefinition {
  source?: 'library' | 'google'
  libraryFont?: string
  googleFont?: string
}

export interface Typescale {
  size?: number
  weight?: number
  lineHeight?: number
  letterSpacing?: number
}

export interface ButtonStyle {
  background?: string
  text?: string
  borderRadius?: number
}

export interface ButtonStyleTheme {
  background?: string
  text?: string
  borderRadius?: number
  hover?: {
    background?: string
    text?: string
  }
}

export interface CardStyleTheme {
  background?: string
  border?: string
}

export interface BackgroundAsset {
  key: string
  name: string
  lightImage?: { asset?: { url: string } }
  darkImage?: { asset?: { url: string } }
}

export interface BackgroundGraphic {
  enabled?: boolean
  asset?: ResolvedImage
  opacity?: number
  scale?: number
  mobileScale?: number
  rotation?: number
  positionPreset?: 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  offsetX?: number
  offsetY?: number
  mobileOffsetX?: number
  mobileOffsetY?: number
  scrollBehavior?: 'fixed' | 'scroll' | 'parallax'
  scope?: 'entire' | 'homepage' | 'hero'
}

export interface HeaderAppearance {
  stickyHeader?: boolean
  initialStyle?: 'transparent' | 'solid' | 'glass'
  scrolledStyle?: 'transparent' | 'solid' | 'glass'
  backgroundOpacity?: number
  blurEffect?: boolean
  shadow?: 'none' | 'small' | 'medium'
  headerHeight?: 'compact' | 'normal' | 'large'
  customHeight?: number
  zIndex?: number
  borderStyle?: 'always' | 'onScroll' | 'never'
}

// ─── Section Surface System ───────────────────────────────────────────────────

export interface GlassStyle {
  backgroundOklch?: string
  backdropBlur?: number
  borderColor?: string
  borderWidth?: number
}

export interface SectionSurfacesTheme {
  surface1?: string
  surface2?: string
  surface3?: string
  brandSurface?: string
  glass?: GlassStyle
}

export interface SectionSurfaces {
  lightTheme?: SectionSurfacesTheme
  darkTheme?: SectionSurfacesTheme
}

/**
 * Motion tokens — timing and easing for all animation components.
 *
 * Durations are stored in ms (integers). Divide by 1000 for motion/react's
 * `duration` prop. Easing strings are valid CSS cubic-bezier values and can
 * be passed directly to motion/react's `ease` prop or to `transition-timing-function`.
 *
 * Inheritance: INHERIT WITH OVERRIDE via mergeShallowObject (no custom merge needed).
 */
export interface MotionTokens {
  /** Micro-interactions, icon state changes — e.g. 120 */
  durationFast?: number
  /** Standard transitions, hover effects — e.g. 200 */
  durationBase?: number
  /** Reveal animations, panel slides — e.g. 350 */
  durationSlow?: number
  /** Hero entrances, page-level transitions — e.g. 600 */
  durationSlower?: number
  /** General-purpose easing — e.g. cubic-bezier(0.4, 0, 0.2, 1) */
  easingStandard?: string
  /** Elements entering the screen — e.g. cubic-bezier(0, 0, 0.2, 1) */
  easingDecelerate?: string
  /** Elements leaving the screen — e.g. cubic-bezier(0.4, 0, 1, 1) */
  easingAccelerate?: string
  /** Important transitions — e.g. cubic-bezier(0.2, 0, 0, 1) */
  easingEmphasized?: string
}

export interface FormInputTheme {
  background?: string
  border?: string
  text?: string
  placeholder?: string
  focusBorder?: string
  errorBorder?: string
  successBorder?: string
  disabledOpacity?: number
}

export interface FormInput {
  lightTheme?: FormInputTheme
  darkTheme?: FormInputTheme
}

/**
 * FormTypography — typographic tokens for form chrome elements.
 * Colors are CSS strings (OKLCH, hex, or var() references).
 * Sizes are in px; buildCssVars() converts to rem.
 * Not theme-split — fallbacks reference theme-aware DS color vars.
 */
export interface FormTypography {
  /** Label text color */
  labelColor?: string
  /** Label font size (px) */
  labelSize?: number
  /** Label font weight (e.g. 500) */
  labelWeight?: number
  /** Help text color */
  helpTextColor?: string
  /** Help text font size (px) */
  helpTextSize?: number
  /** Inline error message color */
  errorTextColor?: string
  /** Inline error message font size (px) */
  errorTextSize?: number
  /** Color of the required * marker */
  requiredColor?: string
}

/**
 * FormGeometry — spacing and shape tokens shared by all input types.
 * All values are px numbers; buildCssVars() converts to appropriate units.
 */
export interface FormGeometry {
  /** Standardised height for single-line inputs (text, email, select, date) */
  inputHeight?: number
  /** Horizontal padding inside inputs */
  paddingX?: number
  /** Vertical padding inside inputs */
  paddingY?: number
  /** Vertical gap between label and input element */
  labelGap?: number
  /** Vertical gap between fields in a form */
  fieldGap?: number
  /** Border radius for inputs — overrides global --radius-md */
  borderRadius?: number
}

export interface CardVariant {
  key: string
  label?: string
  lightTheme?: CardStyleTheme
  darkTheme?: CardStyleTheme
}

export interface DesignSystem {
  /** Sanity document ID — present after GROQ fetch, absent in partial/merged objects */
  _id?: string
  /** Human-readable name for this design system */
  name?: string
  /** Role in the inheritance hierarchy — e.g. "base" | "child" */
  role?: string
  /** Optional description shown in Studio */
  description?: string
  /**
   * Marker shown next to eyebrow labels (hero sections, etc). Curated enum —
   * color always comes from the accent token (--color-primary), never a
   * separate field. Default 'dot' preserves the current hardcoded look of
   * heroLiveCaptureSection / heroLensSection. INHERIT WITH OVERRIDE.
   */
  eyebrowAccent?: 'none' | 'dot' | 'square' | 'brandMark'
  colors?: {
    darkTheme?: ColorTheme
    lightTheme?: ColorTheme
  }
  typography?: {
    headingFont?: FontDefinition
    bodyFont?: FontDefinition
    h1?: Typescale
    h2?: Typescale
    h3?: Typescale
    h4?: Typescale
    bodyLarge?: Typescale
    body?: Typescale
    small?: Typescale
  }
  radius?: {
    small?: number
    medium?: number
    large?: number
  }
  spacing?: {
    xs?: number
    s?: number
    m?: number
    l?: number
    xl?: number
  }
  buttons?: {
    primary?: {
      lightTheme?: ButtonStyleTheme
      darkTheme?: ButtonStyleTheme
    }
    secondary?: {
      lightTheme?: ButtonStyleTheme
      darkTheme?: ButtonStyleTheme
    }
  }
  /** Legacy single-variant card — kept for backward compat. Prefer cardVariants. */
  cards?: {
    lightTheme?: CardStyleTheme
    darkTheme?: CardStyleTheme
  }
  cardVariants?: CardVariant[]
  sectionSurfaces?: SectionSurfaces
  /** Global glass token — consumed by header, navigation dropdown, cards, modals. */
  glass?: GlassStyle
  forms?: {
    input?: FormInput
    textarea?: FormInput
    select?: FormInput
    checkbox?: FormInput
    radio?: FormInput
    /** Typography tokens for labels, help text, and error messages */
    typography?: FormTypography
    /** Spacing and shape tokens shared across all input types */
    geometry?: FormGeometry
  }
  navigation?: {
    menuRadius?: number
    menuGap?: number
    dropdownRadius?: number
    dropdownStyle?: 'solid' | 'glass' | 'surface'
  }
  shadows?: {
    card?: string
    dropdown?: string
    modal?: string
  }
  layout?: {
    maxContentWidth?: number
    maxTextWidth?: number
    sectionPaddingY?: number
    sectionPaddingYCompact?: number
    sectionPaddingYLarge?: number
  }
  /** Animation timing and easing — INHERIT WITH OVERRIDE via mergeShallowObject */
  motion?: MotionTokens
  /**
   * Named media presentation styles — INHERIT + ARRAY_MERGE (like cardVariants).
   * Sections reference a style by key; this array defines what each key looks like.
   */
  mediaStyles?: MediaStyleDefinition[]
  branding?: {
    logo?: { asset?: { _ref: string } }
    logoLight?: { asset?: { _ref: string } }
    logoHeightDesktop?: number
    logoHeightMobile?: number
    favicon?: { asset?: { _ref: string } }
    /** LOCAL ONLY — never inherited */
    openGraphImage?: { asset?: { _ref: string } }
    /** LOCAL ONLY — never inherited */
    appleTouchIcon?: { asset?: { _ref: string } }
  }
  backgroundAssets?: BackgroundAsset[]
}

// ─── Business Location ────────────────────────────────────────────────────────

export interface BusinessLocation {
  street?: string
  postalCode?: string
  city?: string
  state?: string
  country?: string
}

// ─── Tracking — Custom Script Contract ────────────────────────────────────────
// Non-localized: technical identifiers, not user-facing content (CLAUDE.md Localization Rules).
//
// Live contract (ADR-014 Phase C): consumed by TrackingScripts.tsx and
// src/lib/tracking/custom-scripts.ts. Per-script shape matches the values stored
// under the Integration Registry's custom-scripts manifest
// (src/lib/integrations/manifests/custom-scripts.ts), sourced at runtime via
// project.integrationConfigs (see ProjectIntegrations below).

export type ConsentCategory = 'necessary' | 'analytics' | 'marketing' | 'functional'

export interface CustomScript {
  label?: string
  /** Internal documentation — what the script does and why it exists. */
  description?: string
  placement?: 'head' | 'bodyEnd'
  code?: string
  /** Analytics/Marketing scripts will be gated behind visitor consent once the consent feature ships. */
  consentCategory?: ConsentCategory
  enabled?: boolean
}

// ─── Project — Integration Registry runtime (ADR-014 Phase C) ────────────────
// Result shape of projectIntegrationsQuery (queries.ts). This is the runtime
// source for tracking/analytics behavior (GA4, GTM, Meta Pixel, custom scripts,
// consent gating). Fields are declared optional throughout: a project document
// may have no integrationConfigs entries yet, and an individual entry's `values`
// is manifest-shaped (Record<string, unknown> — see IntegrationConfig in
// src/lib/integrations/types.ts) so is not assumed present. Defined locally
// rather than importing IntegrationConfig because the manifest type's fields
// are non-optional (a configured integration always has integrationId/enabled/
// values); a GROQ projection result makes no such guarantee, so this type is
// intentionally more permissive.
export interface ProjectPrivacy {
  /** Fail-closed consent gate — when true and no valid visitor consent exists, all tracking is blocked except necessary custom scripts. */
  consentModeEnabled?: boolean
  /** Emergency override — when true, all tracking halts regardless of individual integration enabled state. */
  trackingKillSwitch?: boolean
}

export interface ProjectIntegrations {
  integrationConfigs?: {
    /** References IntegrationManifest.id in the Integration Registry. */
    integrationId?: string
    enabled?: boolean
    values?: Record<string, unknown>
  }[]
  privacy?: ProjectPrivacy
}

// ─── Site Config (resolved — all strings already locale-resolved by GROQ) ─────

export interface WebsiteSiteConfig {
  tenantSlug: string
  siteName?: string
  defaultLocale: SupportedLocale
  supportedLocales: SupportedLocale[]
  showLangSwitcherInNav?: boolean
  tagline?: string
  logo?: ResolvedImage
  logoLight?: ResolvedImage
  openGraphImage?: { asset?: { _ref: string } }
  backgroundGraphic?: BackgroundGraphic
  headerAppearance?: HeaderAppearance
  languageSwitcherPlacement?: 'header' | 'footer' | 'both'
  themeMode?: 'lightOnly' | 'darkOnly' | 'toggle' | 'system'
  themeSwitcherPlacement?: 'header' | 'footer' | 'both'
  navLinks?: NavLink[]
  ctaLabel?: string
  ctaHref?: string
  footerLinks?: NavLink[]
  footerCtaHeading?: string
  footerCtaSubtext?: string
  footerCtaInputPlaceholder?: string
  footerCtaButtonLabel?: string
  legalName?: string
  legalAddress?: string
  registrationInfo?: string
  foundedYear?: number
  youtubeChannelUrl?: string
  socialLinks?: SocialLink[]
  phone?: string
  email?: string
  /** Structured business location — primary source for map generation */
  location?: BusinessLocation
  /** Legacy flat address string — fallback when location is not yet populated */
  address?: string
  logoHeightDesktop?: number
  logoHeightMobile?: number
  seoDefaultTitle?: string
  seoDefaultDescription?: string
  appleTouchIcon?: { asset?: { _ref: string } }
  /** Canonical domain for this tenant, e.g. "livener.net". Derived from project.customDomain via GROQ join. */
  customDomain?: string
}

// Locale config subset — fetched first to get $defaultLocale for subsequent queries
export interface LocaleConfig {
  defaultLocale: SupportedLocale
  supportedLocales: SupportedLocale[]
}

// ─── Event ───────────────────────────────────────────────────────────────────

export type EventStatus = 'upcoming' | 'live' | 'past'

export interface ScheduleItem {
  _key: string
  time: string
  title?: string
  description?: string
}

/** ADR-016 Phase B — mirrors BlogCategory exactly. Non-routable taxonomy. */
export interface EventCategory {
  _id: string
  title?: string
  /** Locale-resolved slug — coalesced from $locale → $defaultLocale */
  slug?: string
  color?: string
}

export interface Event {
  _id: string
  title?: string
  /** List queries return a resolved { current: string } for the active locale. */
  slug: { current: string }
  /** Detail query (eventBySlugQuery) returns the full per-locale slug map. */
  slugMap?: LocalizedSlugMap
  redirectFrom?: Partial<Record<SupportedLocale, string[]>>
  status: EventStatus
  /** ADR-016 Phase B — resolved from categories[]-> in GROQ */
  categories?: EventCategory[]
  // Placement — Live Page
  featuredOnLivePage?: boolean
  livePageFeatureStartDate?: string
  livePageFeatureEndDate?: string
  // Placement — Home Page
  featuredOnHomePage?: boolean
  homePageFeatureStartDate?: string
  homePageFeatureEndDate?: string
  // Deprecated placement flag — kept for backward compat
  isCurrentLiveEvent?: boolean
  startDate: string
  endDate?: string
  location?: string
  shortDescription?: string
  fullDescription?: PortableTextContent
  heroImage?: ResolvedImage
  gallery?: ResolvedImage[]
  schedule?: ScheduleItem[]
  // Embedded player
  embedPlayerEnabled?: boolean
  embedVideoUrl?: string
  // External stream CTAs
  primaryStreamLabel?: string
  primaryStreamUrl?: string
  secondaryStreamLabel?: string
  secondaryStreamUrl?: string
  youtubeChannelUrl?: string
  // Deprecated streaming fields — kept for backward compat
  youtubeUrl?: string
  ctaLabel?: string
  seoTitle?: string
  seoDescription?: string
}

// ─── Blog ─────────────────────────────────────────────────────────────────────

export interface PostAuthor {
  _id?: string
  name: string
  role?: string
  bio?: string
  avatar?: ResolvedImage
}

export interface BlogCategory {
  _id: string
  title?: string
  /** Locale-resolved slug — coalesced from $locale → $defaultLocale */
  slug?: string
  color?: string
}

export interface PostVideo {
  provider: 'youtube' | 'cloudflare'
  youtubeUrl?: string
  cloudflareVideoId?: string
}

/** Resolved blog post — all string fields are locale-resolved by GROQ */
export interface Post {
  _id: string
  title?: string
  /** List queries: resolved { current: string }. Detail query: full per-locale slug map. */
  slug: { current: string }
  /** Detail query only — full per-locale slug map for hreflang */
  slugMap?: LocalizedSlugMap
  /** Per-locale arrays of old slugs — used for 301 redirects */
  redirectFrom?: Partial<Record<SupportedLocale, string[]>>
  excerpt?: string
  body?: PortableTextContent
  publishedAt?: string
  expiresAt?: string
  featured?: boolean
  coverImage?: ResolvedImage
  featuredVideo?: PostVideo
  /** Computed in GROQ from body word count. Minimum 1. */
  readingTimeMinutes?: number
  author?: PostAuthor
  categories?: BlogCategory[]
  relatedEvent?: {
    _id: string
    title?: string
    slug: { current: string }
    status?: string
    startDate?: string
    endDate?: string
    location?: string
    shortDescription?: string
    heroImage?: ResolvedImage
  }
  seoTitle?: string
  seoDescription?: string
  seoImage?: ResolvedImage
}

// ─── Section types (studiomartegani — all strings locale-resolved) ─────────────

export interface HeroSection {
  _type: 'heroSection'
  _key: string
  // Content
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  eyebrow?: string
  headline?: string
  subheadline?: string
  ctaLabel?: string
  ctaHref?: string
  // Media
  mediaType?: 'image' | 'video'
  heroImage?: SanityImage
  heroVideo?: string
  posterImage?: SanityImage
  // Layout
  heroHeight?: 'small' | 'medium' | 'large' | 'fullscreen'
  mediaLayout?: 'fullBleed' | 'boxed'
  contentWidth?: 'standard' | 'wide' | 'full'
  contentAlignment?: 'left' | 'center' | 'right'
  verticalAlignment?: 'top' | 'center' | 'bottom'
  // Style
  overlayOpacity?: number
  blur?: number
  brightness?: number
}

/**
 * HeroLiveCaptureSection — premium two-column hero with circular event image
 * and an animated phone mockup showing the Livener streaming interface.
 *
 * Reusable across any Abluo tenant whose product centres on live capture
 * (investors page, church page, sports club, festival, community).
 *
 * Visual layers:
 *   1. Large circle — the real-world event being captured (backgroundImage)
 *   2. Phone mockup — the Livener interface streaming the same event (phoneScreenImage)
 *
 * Animation:
 *   - Idle: phone floats up/down, circle drifts
 *   - Mouse: phone tilts in 3D (rotateX/Y), circle moves opposite at ~25%
 *   - Scroll: circle moves upward, phone rotates slightly (max 2°)
 *   - Respects prefers-reduced-motion
 */
export interface HeroLiveCaptureSection {
  _type: 'heroLiveCaptureSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Short overline above the headline — e.g. "Livener for Investors" */
  eyebrow?: string
  /** Main headline — supports newlines for line breaks */
  title?: string
  /** Supporting paragraph below the headline */
  subtitle?: string
  /** CTAs — resolved from ctas[] array via CTA_FIELDS projection */
  ctas?: Cta[]
  /**
   * Large circular background image representing the event being captured
   * (football pitch, church, concert stage, etc.).
   * GROQ-resolved to ResolvedImage via sections[] projection.
   */
  backgroundImage?: ResolvedImage
  /**
   * Image displayed inside the phone screen as the live video feed.
   * Falls back to backgroundImage if not set.
   * GROQ-resolved to ResolvedImage via sections[] projection.
   */
  phoneScreenImage?: ResolvedImage
  /** Diameter of the circular event image — default 'md' (400px) */
  circleSize?: 'sm' | 'md' | 'lg'
  /** Controls tilt/float amplitude — default 'moderate' */
  animationIntensity?: 'subtle' | 'moderate' | 'expressive'
}

/**
 * HeroLensSection — two-column hero built around the story of filming a live event.
 *
 * Visual concept:
 *   Layer 1: Large circular background image — the real-world event (backgroundImage)
 *   Layer 2: Foreground PNG — a hand holding a smartphone, rendered exactly as uploaded.
 *            The phone screen content is part of the supplied image. No phone is generated.
 *
 * Animation (subtle, premium):
 *   - Idle: background circle drifts slowly; foreground floats gently (vertical only)
 *   - Mouse: background moves 15–20px; foreground at ~20% of that intensity
 *   - Scroll: background parallaxes up; foreground tilts very subtly (max 1.5°)
 *   - Respects prefers-reduced-motion
 */
export interface HeroLensSection {
  _type: 'heroLensSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Short overline above the headline */
  eyebrow?: string
  /** Main headline — supports newlines for line breaks */
  title?: string
  /** Supporting paragraph below the headline */
  subtitle?: string
  /** CTAs — resolved from ctas[] array via CTA_FIELDS projection */
  ctas?: Cta[]
  /**
   * Image displayed inside the large background circle.
   * Represents the real-world event being filmed.
   */
  backgroundImage?: ResolvedImage
  /**
   * Complete foreground PNG — a hand holding a smartphone.
   * Rendered exactly as supplied. The phone screen content is part of this image.
   */
  foregroundImage?: ResolvedImage
}

/**
 * Resolved media style definition — pulled from designSystem.mediaStyles by key.
 * The section reads this to apply CSS properties without any hardcoded visual values.
 */
export interface MediaStyleDefinition {
  key: string
  label?: string
  /** Border radius in px. 9999 = full circle. */
  borderRadius?: number
  /** CSS aspect-ratio value: 'auto', '1/1', '4/3', '3/4', '16/9' */
  aspectRatio?: string
  objectFit?: 'cover' | 'contain'
}

/** Media Content Section (Sanity type: 'contentSection' — name kept for backward compat) */
export interface MediaContentSection {
  _type: 'contentSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  eyebrow?: string
  title?: string
  body?: PortableTextContent
  image?: ResolvedImage
  /** Resolved from coalesce(mediaPosition, imagePosition) — migrates old data automatically */
  mediaPosition?: 'left' | 'right' | 'top' | 'bottom' | 'none'
  /** DS media style key — the component looks up the style definition from designSystem.mediaStyles */
  mediaStyle?: string
  /** Width ratio between text and media columns — only applies for left/right positions */
  contentRatio?: '40/60' | '50/50' | '60/40'
  /** How to align columns vertically — only applies for left/right positions */
  verticalAlignment?: 'top' | 'center' | 'bottom'
  /** Show text before media on mobile regardless of desktop position */
  reverseOnMobile?: boolean
  primaryCta?: Cta
  secondaryCta?: Cta
}

/** @deprecated Use MediaContentSection */
export type ContentSection = MediaContentSection

export interface TeamMember {
  _type: 'teamMemberObject'
  _key: string
  name: string
  role?: string
  bio?: string
  // GROQ projects photo { asset, hotspot, crop } — no _type field — so ResolvedImage, not SanityImage
  photo?: ResolvedImage
}

export interface TeamSection {
  _type: 'teamSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  title?: string
  subtitle?: string
  intro?: PortableTextContent
  members?: TeamMember[]
}

export interface TextSection {
  _type: 'textSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  eyebrow?: string
  title?: string
  content?: PortableTextContent
}

/**
 * VideoSection — platform section for a real, watchable video player
 * (Cloudflare Stream, YouTube, Vimeo, or a standard embeddable/direct URL).
 * Distinct from HeroSection's `heroVideo` (muted/looping/no-controls
 * background video). Presentation only — no module data ownership.
 */
export interface VideoSection {
  _type: 'videoSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  provider: 'cloudflare' | 'youtube' | 'vimeo' | 'url'
  /** Provider-specific ID — Cloudflare Stream UID, YouTube video ID, or Vimeo video ID. Unused when provider is 'url'. */
  videoId?: string
  /** Standard embeddable or direct video URL. Only used when provider is 'url'. */
  videoUrl?: string
  eyebrow?: string
  title?: string
  caption?: string
  aspectRatio?: '16:9' | '4:3' | '9:16'
}

export interface TreatmentCard {
  _type: 'treatmentCard'
  _key: string
  name: string
  tagline?: string
  description?: string
}

export interface TreatmentsSection {
  _type: 'treatmentsSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  eyebrow?: string
  title?: string
  intro?: string
  treatments?: TreatmentCard[]
}

export interface FAQItem {
  _key: string
  question?: string
  answer?: string
}

export interface FAQSection {
  _type: 'faqSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  eyebrow?: string
  title?: string
  items?: FAQItem[]
}

export interface ContactSection {
  _type: 'contactSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  title?: string
  subtitle?: string
  /** Whether to render the interactive map. Default true. */
  showMap?: boolean
  /** Map iframe height in pixels. Default 400. */
  mapHeight?: number
  /** Map colour theme. 'dark' is reserved for a future Maps JS API migration; v1 always renders the standard map. */
  mapTheme?: 'auto' | 'light' | 'dark'
}

export interface BlogListingSection {
  _type: 'blogListingSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Locale-resolved by GROQ */
  eyebrow?: string
  /** Locale-resolved by GROQ */
  title?: string
  /** Locale-resolved by GROQ */
  subtitle?: string
  filterMode?: 'latest' | 'featured' | 'byCategory' | 'byEvent' | 'manual'
  sortOrder?: 'newest' | 'oldest' | 'manual'
  layout?: 'grid' | 'featured' | 'magazine'
  maxItems?: number
  /** Locale-resolved by GROQ */
  viewAllLabel?: string
  viewAllHref?: string
  /** Resolved from category->._id in GROQ */
  categoryId?: string
  /** Resolved from event->._id in GROQ */
  eventId?: string
  /** Resolved from posts[]->._id in GROQ — used for manual selection */
  postIds?: string[]
  /** Hydrated server-side in page.tsx — not stored in Sanity */
  posts?: Post[]
  /**
   * ADR-016 Phase B — optional localized empty state. Semantics (frontend
   * concern): zero posts + both fields undefined/empty → render nothing
   * (preserves today's behavior). Zero posts + a field set → render the
   * localized empty block instead of the grid.
   */
  emptyStateHeading?: string
  /** Locale-resolved by GROQ */
  emptyStateBody?: string
}

// ─── Events Listing Section ───────────────────────────────────────────────────
// ADR-016 Phase B — modeled on BlogListingSection. Owned by the Events module.

export interface EventsListingSection {
  _type: 'eventsListingSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Locale-resolved by GROQ */
  eyebrow?: string
  /** Locale-resolved by GROQ */
  title?: string
  /** Locale-resolved by GROQ */
  subtitle?: string
  /** Restricts results by date relative to now() — combined with filterMode. 'live' = status == "live" (ADR-016 Phase C) */
  timeFilter?: 'upcoming' | 'live' | 'past' | 'all'
  filterMode?: 'latest' | 'featured' | 'byCategory' | 'manual'
  sortOrder?: 'newest' | 'oldest' | 'manual'
  layout?: 'grid' | 'featured' | 'magazine'
  maxItems?: number
  /** Locale-resolved by GROQ */
  viewAllLabel?: string
  viewAllHref?: string
  /** Resolved from category->._id in GROQ */
  categoryId?: string
  /** Resolved from events[]->._id in GROQ — used for manual selection */
  eventIds?: string[]
  /** Hydrated server-side in page.tsx — not stored in Sanity */
  events?: Event[]
  /** ADR-016 Phase B — see BlogListingSection.emptyStateHeading for semantics */
  emptyStateHeading?: string
  /** Locale-resolved by GROQ */
  emptyStateBody?: string
}

// ─── Live Latest Section ──────────────────────────────────────────────────────
// ADR-016 Phase B — renders the current/next-upcoming live event, hero-style.
// Owned by the Live module. Selection logic mirrors currentLiveEventQuery.

export interface LiveLatestSection {
  _type: 'liveLatestSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Locale-resolved by GROQ */
  eyebrow?: string
  /** Locale-resolved by GROQ */
  title?: string
  /** Hydrated server-side in page.tsx via currentLiveEventQuery — not stored in Sanity */
  event?: Event | null
  /** ADR-016 Phase B — see BlogListingSection.emptyStateHeading for semantics (applies when there is no current/upcoming event) */
  emptyStateHeading?: string
  /** Locale-resolved by GROQ */
  emptyStateBody?: string
}

// ─── Form System ──────────────────────────────────────────────────────────────
// All string fields are locale-resolved by GROQ — no raw localizedString objects here.

export interface SanityFormOption {
  value: string
  label: string
}

export interface SanityFormField {
  id: string
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'radio-group' | 'checkbox' | 'checkbox-group'
  label?: string
  placeholder?: string
  helpText?: string
  checkboxLabel?: string
  required?: boolean
  width?: '50%' | '100%'
  rows?: number
  options?: SanityFormOption[]
}

export interface SanityForm {
  _id: string
  projectSlug?: string
  description?: string
  submitLabel?: string
  successMessage?: string
  inquiryType?: string
  fields?: SanityFormField[]
}

// ── Renderable form definition (ADR-018 slice 4) ──────────────────────────────
// GROQ-resolved, locale-applied projection of a tenant-owned `formDefinition`,
// shaped for the Field Library renderer. Field `id` is the definition's stable
// `internalKey`. Only the visitor-facing strings are localized.
export interface RenderableFormOption {
  value: string
  label: string
}
export interface RenderableFormField {
  id: string
  type: string
  required?: boolean
  width?: '50%' | '100%'
  label: string
  placeholder?: string
  help?: string
  options?: RenderableFormOption[]
  /** May a placement's Context pre-populate this field? (ADR-018 §7) */
  contextMappable?: boolean
}

/** A placement Context key/value pair set on the Form Section (ADR-018 slice 5). */
export interface FormSectionContextItem {
  key: string
  value: string
}
export interface RenderableFormStep {
  key: string
  title?: string
  fields: RenderableFormField[]
}
export interface RenderableFormDefinition {
  _id: string
  formId: string
  formType?: 'single-step' | 'multi-step' | 'question-answer'
  version?: number
  title?: string
  tenantSlug?: string
  steps: RenderableFormStep[]
  requireConsent?: boolean
  consentText?: string
  successTitle?: string
  successBody?: string
}

export interface FormSection {
  _type: 'formSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Dereferenced formDefinition — null if not set or not published (ADR-018 slice 4). */
  definition?: RenderableFormDefinition | null
  /** Static placement Context — pre-fills contextMappable fields (ADR-018 slice 5). */
  context?: FormSectionContextItem[] | null
}

/** A button that opens a formDefinition as an overlay (ADR-018 slice 7). */
export interface FormOverlayButtonSection {
  _type: 'formOverlayButtonSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Dereferenced formDefinition — null if not set or not published. */
  definition?: RenderableFormDefinition | null
  /** Static placement Context — pre-fills contextMappable fields. */
  context?: FormSectionContextItem[] | null
  /** Localized button label. */
  buttonLabel?: string | null
  /** Localized overlay heading; falls back to the definition's own title. */
  overlayTitle?: string | null
  buttonStyle?: 'primary' | 'secondary'
  buttonAlign?: 'left' | 'center' | 'right'
}

export interface StatementSection {
  _type: 'statementSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Locale-resolved by GROQ */
  eyebrow?: string
  /** Locale-resolved by GROQ */
  headline?: string
  /** Locale-resolved by GROQ */
  description?: string
  alignment?: 'left' | 'center'
  image?: SanityImage
  imagePosition?: 'left' | 'right'
}

// ─── Metrics Section ──────────────────────────────────────────────────────────

export interface MetricItem {
  _type: 'metricItem'
  _key: string
  /** Not localized — values like "£10bn+", "2025", "Innovate UK" */
  value: string
  /** Locale-resolved by GROQ */
  label?: string
  /** Locale-resolved by GROQ */
  description?: string
  /** Reserved for future count-up animation. Has no effect yet. */
  animateNumber?: boolean
}

export interface MetricsSection {
  _type: 'metricsSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Locale-resolved by GROQ */
  eyebrow?: string
  /** Locale-resolved by GROQ */
  headline?: string
  /** Locale-resolved by GROQ */
  description?: string
  metrics?: MetricItem[]
}

// ─── Gallery Module ────────────────────────────────────────────────────────────

export interface GalleryMediaAsset {
  _id: string
  mediaType?: 'image' | 'video'
  /** Locale-resolved image reference */
  image?: ResolvedImage
  videoUrl?: string
  /** Locale-resolved by GROQ */
  altText?: string
  /** Locale-resolved by GROQ */
  title?: string
  /** Locale-resolved by GROQ */
  caption?: string
}

export interface GalleryItem {
  _key: string
  mediaAsset?: GalleryMediaAsset
  titleOverrideEnabled?: boolean
  /** Locale-resolved by GROQ — only set when titleOverrideEnabled */
  titleOverride?: string
  captionOverrideEnabled?: boolean
  /** Locale-resolved by GROQ — only set when captionOverrideEnabled */
  captionOverride?: string
  /** Effective display title: override if set, else Media Library title */
  displayTitle?: string
  /** Effective caption: override if set, else Media Library caption */
  displayCaption?: string
}

export interface Gallery {
  _id: string
  _type: 'gallery'
  projectSlug: string
  internalName: string
  slug?: { current: string }
  /** Locale-resolved by GROQ */
  description?: string
  items?: GalleryItem[]
}

export interface PhotoGallerySection {
  _type: 'photoGallerySection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  /** Locale-resolved by GROQ */
  eyebrow?: string
  /** Locale-resolved by GROQ */
  headline?: string
  /** Locale-resolved by GROQ */
  description?: string
  gallery?: Gallery
  columns?: 2 | 3 | 4
  imageRatio?: 'square' | 'landscape' | 'portrait' | 'auto'
  spacing?: 'tight' | 'normal' | 'loose'
  showCaptions?: boolean
}

export type PageSection =
  | HeroSection
  | HeroLiveCaptureSection
  | HeroLensSection
  | MediaContentSection
  | StatementSection
  | TreatmentsSection
  | TeamSection
  | TextSection
  | VideoSection
  | FAQSection
  | ContactSection
  | BlogListingSection
  | FormSection
  | FormOverlayButtonSection
  | MetricsSection
  | PhotoGallerySection
  | EventsListingSection
  | LiveLatestSection

export interface WebsiteHomePage {
  tenantSlug: string
  backgroundPattern?: 'none' | 'alternate1-2' | 'alternate1-2-3'
  sections?: PageSection[]
}

// LocalizedSlugMap — the raw Sanity structure for a localizedSlug field.
// Each locale holds a proper Sanity slug object. Used as "slugMap": slug in GROQ projections.
export type LocalizedSlugMap = Partial<Record<SupportedLocale, { _type: 'slug'; current: string }>>

export interface WebsitePage {
  _id: string
  pageType: 'home' | 'about' | 'contact' | 'team' | 'services' | 'landing' | 'legal'
  title?: string
  /** Full per-locale slug map, returned as "slugMap": slug in pageBySlugQuery */
  slugMap?: LocalizedSlugMap
  /** Per-locale arrays of old slugs — used for 301 redirects */
  redirectFrom?: Partial<Record<SupportedLocale, string[]>>
  backgroundPattern?: 'none' | 'alternate1-2' | 'alternate1-2-3'
  sections?: PageSection[]
}

// ─── Live Page ────────────────────────────────────────────────────────────────
// Resolved by livePageQuery — all string fields are locale-resolved by GROQ.

// ADR-016 Phase A: `sections?: PageSection[]` is additive on all three
// singleton interfaces below — optional, so existing published documents
// (which never populate it) remain valid. Phase C migrates the fixed fields
// above it into equivalent sections and retires the fixed shape.

// ADR-016 Phase C — heroTitle, heroSubtitle, betaNotice, introText, heroImage,
// cloudflareVideoId, featuredEvents retired: zero remaining runtime reads
// (the body is fully section-driven; see migration 002 + 003).
export interface LivePage {
  _id: string
  seoTitle?: string
  seoDescription?: string
  sections?: PageSection[]
}

// ─── Events Page ──────────────────────────────────────────────────────────────
// ADR-016 Phase C — introText, heroImage, cloudflareVideoId retired (no
// remaining reads). heroTitle/heroSubtitle are KEPT — still read as
// SEO-fallback strings by generateMetadata in events/page.tsx.

export interface EventsPage {
  _id: string
  heroTitle?: string
  heroSubtitle?: string
  seoTitle?: string
  seoDescription?: string
  sections?: PageSection[]
}

// ─── Blog Page ────────────────────────────────────────────────────────────────
// Resolved by blogPageQuery — all string fields are locale-resolved by GROQ.
// Singleton per project — controls the /blog listing route hero and SEO.
// ADR-016 Phase C — eyebrow retired (no remaining reads). heroTitle/
// heroSubtitle are KEPT — still read as SEO-fallback strings by
// generateMetadata in blog/page.tsx.

export interface BlogPage {
  _id: string
  heroTitle?: string
  heroSubtitle?: string
  seoTitle?: string
  seoDescription?: string
  sections?: PageSection[]
}
