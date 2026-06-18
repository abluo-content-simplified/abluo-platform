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

// ─── Navigation ───────────────────────────────────────────────────────────────

export interface NavLink {
  label: string
  linkType?: 'internal' | 'external'
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
  address?: string
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

export interface Event {
  _id: string
  title?: string
  /** List queries return a resolved { current: string } for the active locale. */
  slug: { current: string }
  /** Detail query (eventBySlugQuery) returns the full per-locale slug map. */
  slugMap?: LocalizedSlugMap
  redirectFrom?: Partial<Record<SupportedLocale, string[]>>
  status: EventStatus
  isCurrentLiveEvent?: boolean
  startDate: string
  endDate?: string
  location?: string
  shortDescription?: string
  fullDescription?: PortableTextContent
  heroImage?: ResolvedImage
  gallery?: ResolvedImage[]
  schedule?: ScheduleItem[]
  youtubeUrl?: string
  youtubeChannelUrl?: string
  ctaLabel?: string
  seoTitle?: string
  seoDescription?: string
}

// ─── Section types (studiomartegani — all strings locale-resolved) ─────────────

export interface HeroSection {
  _type: 'heroSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  eyebrow?: string
  headline?: string
  subheadline?: string
  ctaLabel?: string
  ctaHref?: string
  backgroundImage?: SanityImage
}

export interface ContentSection {
  _type: 'contentSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  eyebrow?: string
  title?: string
  body?: PortableTextContent
  image?: SanityImage
  imagePosition?: 'left' | 'right'
}

export interface TeamMember {
  _type: 'teamMemberObject'
  _key: string
  name: string
  role?: string
  bio?: string
  photo?: SanityImage
}

export interface TeamSection {
  _type: 'teamSection'
  _key: string
  background?: 'usePagePattern' | 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass'
  title?: string
  subtitle?: string
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
  mapEmbedUrl?: string
}

export type PageSection =
  | HeroSection
  | ContentSection
  | TreatmentsSection
  | TeamSection
  | TextSection
  | FAQSection
  | ContactSection

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

export interface LivePage {
  _id: string
  heroTitle?: string
  heroSubtitle?: string
  betaNotice?: string
  introText?: string
  heroImage?: ResolvedImage
  /** Cloudflare Stream video ID (e.g. "abc123xyz"). Frontend generates embed URL. */
  cloudflareVideoId?: string
  /** Expanded event references — locale-resolved by GROQ dereference */
  featuredEvents?: Event[]
  seoTitle?: string
  seoDescription?: string
}

// ─── Events Page ──────────────────────────────────────────────────────────────

export interface EventsPage {
  _id: string
  heroTitle?: string
  heroSubtitle?: string
  introText?: string
  heroImage?: ResolvedImage
  /** Cloudflare Stream video ID (e.g. "abc123xyz"). Frontend generates embed URL. */
  cloudflareVideoId?: string
  seoTitle?: string
  seoDescription?: string
}
