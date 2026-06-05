# Abluo — Platform Documentation

## Overview

Abluo is a reusable multi-tenant publishing platform for professional practices (dentists, therapists, consultants, event organizers, studios, etc.). One codebase, one Sanity project, one Supabase instance. Each tenant (client) gets their own domain, branding, and content—logically isolated by `tenantSlug` on every Sanity document.

**Current tenants:** studiomartegani · livener

---

## Technology Stack

- **Frontend:** Next.js 15+ (App Router, TypeScript) · Tailwind CSS v4 · shadcn/ui
- **CMS:** Sanity v3 (headless, no studio deploy command)
- **Backend/Auth:** Supabase (authentication, leads, operational data)
- **Hosting:** Vercel (auto-deploy on git push)
- **UI/Icons:** Lucide · Motion (motion/react) for animations
- **Images:** Sanity CDN only (via @sanity/image-url builder)

---

## Architecture Principles

### Multi-Tenancy

- **Single deployment:** All tenants share one Next.js app, one Sanity project, one Supabase instance
- **Data isolation:** Every content document has `tenantSlug` field
- **Route structure:** `/[locale]/[tenant]/[path]` — URL-based tenant routing
- **Separate domains:** Each tenant gets their own domain (e.g., studiomartegani.it, livener.io) via Vercel

### Internationalization (i18n)

- **Field-level translation:** Content stored as objects: `{ it: "...", en: "..." }`
- **Tenant-specific defaults:** `siteConfig.defaultLocale` per tenant (e.g., studiomartegani = it, livener = en)
- **Supported languages:** Defined in `siteConfig.supportedLocales` array
- **GROQ fallback chain:** `coalesce(field[$locale], field[$defaultLocale], field.en, field)`
- **URL routing:** next-intl middleware handles `/[locale]/...` routes
- **Language selection:** Footer-only switcher by default. Browser language auto-detected on first visit; user choice persists in localStorage

### Theme System

- **Options:** light / dark / system
- **Storage:** `data-theme` attribute on `<html>` element
- **Persistence:** localStorage remembers user choice
- **Implementation:** JavaScript-driven (no CSS attribute selectors for theme detection)

### Images

- **Source:** All images served through Sanity CDN
- **Optimization:** Pre-optimize originals before upload (~2400px wide, WebP/JPG preferred)
- **Alt text:** Localized on every image field (required)
- **Hotspots:** Enabled for intelligent cropping
- **Build:** Never use raw CDN URLs; always use `@sanity/image-url` builder

### Animations

- **Default library:** Motion (motion/react)
- **Exception:** GSAP only for exceptional cases requiring fine-grained control
- **Architecture:** Reusable animation primitives at `src/components/animation/`
- **Rule:** Animation logic lives in components, never in CMS content

### Sanity Studio

- **Deployment:** Embedded in Next.js at `/studio` route
- **Schema:** Deployed with the app; do NOT run `npx sanity deploy`
- **Local access:** `localhost:3000/studio`
- **Production access:** `[app-domain]/studio`
- **Structure:** Per-tenant organization (Settings, Home Page, Content, etc.)

---

## Schema Architecture

### Shared Localized Types (All Tenants)

```typescript
localizedString  // { it: string, en: string }
localizedText    // { it: text, en: text }
localizedPortableText // { it: block[], en: block[] }
localizedImage   // image + localized alt + caption + hotspot
navigationLink   // { label: localizedString, href: string, external: boolean }
socialLink       // { platform: string, url: string }
scheduleItem     // { time: string, title: localizedString, description: localizedText }
```

### Core Documents

**siteConfig** (per tenant)
- Identity: siteName, tagline, logo, logoLight, faviconSvg, faviconPng
- Languages: defaultLocale, supportedLocales
- Navigation: navLinks[], showLangSwitcherInNav, ctaLabel, ctaHref
- Contact: phone, email, address, contactEmail, mobileNumber, whatsappNumber, whatsappSubjects[], emailSubjects[]
- Footer: footerLinks[], footerCtaHeading/Subtext/InputPlaceholder/ButtonLabel, legalName, legalAddress, registrationInfo, foundedYear
- Social: youtubeChannelUrl, socialLinks[]

**homePage** (per tenant)
- Sections: array of modular section types (hero, content, treatments, team, text, faq, contact)

**event** (shared document type, tenant-isolated by tenantSlug)
- Identity: title, slug, tenantSlug
- Status: 'upcoming' | 'live' | 'past'
- Editorial: isCurrentLiveEvent (boolean override for /live page)
- Dates: startDate, endDate
- Content: location, shortDescription, fullDescription, schedule[], gallery[]
- Media: heroImage, gallery[]
- Streaming: youtubeUrl, youtubeChannelUrl, ctaLabel
- SEO: seoTitle, seoDescription

**post** (per tenant, blog articles)
- title, slug, excerpt, body, publishedAt

---

## GROQ Queries

Key query patterns (in `src/lib/sanity/queries.ts`):

- **localeConfigQuery** — fetch `{ defaultLocale, supportedLocales }` first (run once in layout)
- **websiteSiteConfigQuery** — full siteConfig with locale fallback chain applied
- **currentLiveEventQuery** — pick by `isCurrentLiveEvent` flag → status == "live" → next upcoming by startDate
- **eventsQuery** — all events for a tenant (filtered by tenantSlug)
- **eventBySlugQuery** — single event by slug
- **postsQuery** — all blog posts for a tenant

All queries accept `$tenant` and `$locale` parameters.

---

## File Organization

### Core Files
- `src/lib/sanity/schema.ts` — all type definitions
- `src/lib/sanity/queries.ts` — GROQ queries
- `src/lib/sanity/types.ts` — TypeScript types
- `src/lib/sanity/image.ts` — image URL builders and helpers
- `sanity.config.ts` — Sanity Studio configuration

### Components
- `src/components/animation/` — reusable animation primitives (FadeIn, SlideUp, StaggerChildren, ParallaxImage)
- `src/components/[tenant]/` — tenant-specific components (Nav, Footer, etc.)
- `src/components/ui/` — shadcn/ui components

### Routes
- `src/app/[locale]/(website)/[tenant]/` — main website routes
- `src/app/[locale]/(website)/[tenant]/layout.tsx` — tenant layout (wires Nav/Footer)
- `src/app/[locale]/admin/` — admin dashboard (if applicable)

### Theming
- `src/themes/[tenant]/` — tenant-specific design tokens and styles
  - `tokens.css` — CSS custom properties
  - `tailwind.config.ts` — Tailwind theme extension
  - `preview.html` — design system preview (optional)

---

## Development Workflow

### Schema Changes

1. Modify `src/lib/sanity/schema.ts`
2. Run `npm run build` to regenerate manifest
3. Run `npx sanity@latest schema deploy`
4. Schema is now live; Studio will pick it up on next refresh

### Adding a New Tenant

1. Create tenant-specific folder: `src/themes/[tenant]/`
2. Add design tokens (colors, fonts, spacing)
3. Create tenant layout: `src/app/[locale]/(website)/[tenant]/layout.tsx`
4. Create siteConfig document in Sanity with tenantSlug = [tenant]
5. Wire up Nav/Footer components in layout
6. Deploy to Vercel

### Deployment

- Push to `main` branch → Vercel auto-builds and deploys
- Schema changes deploy with the app
- Preview deployments available for non-main branches

---

## Key Conventions

- **Tenant isolation:** Always filter by `tenantSlug` in GROQ queries
- **Locale resolution:** Use GROQ fallback chain; never assume a locale exists
- **Component structure:** Separate server components (data fetching) from client components (interactivity)
- **CSS:** Use Tailwind v4; avoid arbitrary CSS selectors for theme detection (use JavaScript instead)
- **Images:** Always optimize before upload; use Sanity image URL builder
- **Animations:** Keep in components, not content; use Motion by default

---

## Future Enhancements

- AI-assisted content generation (abstracts, FAQ, SEO metadata, alt text)
- Advanced analytics per tenant
- Leads/contact management dashboard
- Automated translations
- Custom email templates for contact subjects
- WhatsApp integration for contact options

---

## Support & Questions

Refer to individual tenant documentation (CLAUDE.md) for tenant-specific implementation details. This file covers platform-wide architecture and conventions.
