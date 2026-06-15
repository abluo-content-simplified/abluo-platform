// ─── Localized primitives ──────────────────────────────────────────────────────
// GROQ resolves these before they reach the frontend — components receive plain
// strings/arrays. These raw types are only used if you query the unresolved document.

export interface LocalizedString {
  it?: string
  en?: string
  de?: string
}

export type SupportedLocale = 'en' | 'it' | 'de'

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
  internalPage?: 'homepage' | 'live'
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

export interface DesignSystem {
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
  cards?: {
    lightTheme?: CardStyleTheme
    darkTheme?: CardStyleTheme
  }
  sectionSurfaces?: SectionSurfaces
  branding?: {
    logo?: { asset?: { _ref: string } }
    logoLight?: { asset?: { _ref: string } }
    favicon?: { asset?: { _ref: string } }
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
  // Live page welcome text (managed in Sanity)
  livePageHeadline?: string
  livePageSubheadline?: string
  livePageBetaNotice?: string
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
  slug: { current: string }
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

export interface WebsitePage {
  _id: string
  pageType: 'home' | 'about' | 'contact' | 'team' | 'services' | 'landing' | 'legal'
  title?: string
  slug: { current: string }
  backgroundPattern?: 'none' | 'alternate1-2' | 'alternate1-2-3'
  sections?: PageSection[]
}
