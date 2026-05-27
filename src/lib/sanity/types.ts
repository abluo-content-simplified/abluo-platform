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

export interface SanityImage {
  _type: 'image'
  asset: { _ref: string; _type: 'reference' }
  hotspot?: { x: number; y: number; height: number; width: number }
}

// ─── Section types ────────────────────────────────────────────────────────────

export interface HeroSection {
  _type: 'heroSection'
  _key: string
  headline?: string
  subheadline?: string
  ctaLabel?: string
  ctaHref?: string
  backgroundImage?: SanityImage
}

export interface ContentSection {
  _type: 'contentSection'
  _key: string
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
  | ContactSection

// ─── Documents ────────────────────────────────────────────────────────────────

export interface WebsiteSiteConfig {
  tenantSlug: string
  siteName?: string
  tagline?: string
  phone?: string
  email?: string
  address?: string
  logo?: SanityImage
}

export interface WebsiteHomePage {
  tenantSlug: string
  sections?: PageSection[]
}
