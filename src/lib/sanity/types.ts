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
  href: string
  external?: boolean
}

export interface SocialLink {
  platform: 'youtube' | 'instagram' | 'linkedin' | 'facebook' | 'x' | 'tiktok' | 'threads'
  url: string
}

// ─── Design System ────────────────────────────────────────────────────────────

export interface ColorTheme {
  background?: string
  backgroundAlt?: string
  primary?: string
  secondary?: string
  accent?: string
  textPrimary?: string
  textSecondary?: string
  border?: string
}

export interface ButtonStyle {
  background?: string
  text?: string
  borderRadius?: number
}

export interface DesignSystem {
  colors?: {
    darkTheme?: ColorTheme
    lightTheme?: ColorTheme
  }
  typography?: {
    headingFont?: string
    bodyFont?: string
  }
  radius?: {
    small?: number
    medium?: number
    large?: number
  }
  buttons?: {
    primary?: ButtonStyle
    secondary?: ButtonStyle
  }
  cards?: {
    background?: string
    border?: string
  }
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
  title?: string
  subtitle?: string
  members?: TeamMember[]
}

export interface TextSection {
  _type: 'textSection'
  _key: string
  eyebrow?: string
  title?: string
  content?: PortableTextContent
  backgroundColor?: 'white' | 'grey' | 'dark'
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
  eyebrow?: string
  title?: string
  items?: FAQItem[]
}

export interface ContactSection {
  _type: 'contactSection'
  _key: string
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
  sections?: PageSection[]
}
