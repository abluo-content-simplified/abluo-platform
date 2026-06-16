# Abluo — Project Intelligence

## What Abluo Is

Abluo is a modern website management platform for small businesses. It helps companies publish content, manage leads, and improve SEO automatically with built-in AI tools — all through a clean and extremely easy-to-use interface.

The differentiators are:
- **Simplicity** — no learning curve, works on a phone
- **Elegance** — premium, calm, polished design
- **Automation** — AI handles SEO, FAQ, translation, metadata
- **Content intelligence** — the system helps users write better, not just publish

Abluo is NOT trying to be WordPress, HubSpot, Webflow, Notion, or a full marketing suite. It is focused.

---

## Who Uses It

### 1. Abluo Admin (Tom)
Manages the entire platform: clients, their websites, schemas, themes, branding, and infrastructure. Has full access to Sanity for managing page structures and static content. Uses the **Abluo Admin Dashboard**.

### 2. Client (e.g. a dentist, therapist, consultant)
Never sees Sanity. Uses a tiny, beautiful **Client Dashboard** to:
- Write and publish blog posts / news
- Manage incoming leads (contact requests)
- View basic analytics
- Improve SEO automatically — no marketing knowledge required

The client experience must be so simple it works on a phone. Ideally: dictate a post, review it, publish. Done.

---

## Infrastructure

| Layer | Tool | Purpose |
|---|---|---|
| CMS | Sanity | All website content — pages, blog posts, themes, media |
| Auth + Leads | Supabase | Authentication, lead storage, operational data |
| Frontend | Next.js | Website rendering + both dashboards |
| Styling | Tailwind CSS + shadcn/ui | UI components and design system |
| Hosting | Vercel | Deployments per client domain |
| AI | To be defined | Writing assistance, FAQ, SEO, translation |

**Key principle:** Clients write into a tiny custom interface that talks to Sanity. They never see Sanity itself.

---

## What We Are Currently Building

### Phase 1 — Two Dashboards

**1. Abluo Admin Dashboard**
- View and manage all clients
- View and manage all projects / websites
- Access content across all clients
- Settings and configuration

**2. Client Dashboard**
- Write and publish blog posts / news
- Manage leads (contact form submissions)
- Basic analytics overview
- AI tools: writing help, FAQ generation, SEO metadata, translation

---

## Static Page Content

Static pages (About, Services, Contact, etc.) are managed by the Abluo admin directly in Sanity. Clients do not manage static content. This is intentional — it keeps the client interface minimal and prevents mistakes.

---

## AI Features (Planned)

- Generate excerpt / abstract from article
- Generate FAQ (4–5 questions) from article content — for SEO and AEO
- Generate SEO metadata (title, description, keywords)
- AI writing assistant for blog posts
- Auto-translation for multilingual sites
- Alt-text generation for images

---

## Design Principles

- Calm, elegant, minimal
- Premium but not corporate
- Mobile-first for the client dashboard
- No complexity exposed to clients
- Animations and motion belong to components, not content
- Strong design system foundation — spacing, typography, tokens, motion language

---

## Tech Stack

- **Next.js 15** — App Router, RSC, TypeScript
- **Tailwind CSS v4**
- **shadcn/ui** — component library
- **Sanity** — headless CMS
- **Supabase** — auth and leads
- **Vercel** — hosting
- **Lucide** — icons

---

## What NOT to Build (Yet)

- Advanced role management
- Complex billing
- Custom icon systems
- Micro-optimized animations
- Advanced DB modeling
- CI/CD pipelines
- Full marketing analytics suite

Keep asking: *"What is the simplest version that proves the concept?"*

---

## Multi-Tenancy

- Shared codebase and backend
- Separate deployment per client (own domain)
- Sanity and Supabase use `tenant_id` to separate data
- Platform owner (Tom) manages all structural decisions

---

## Localization Architecture

There are two completely separate localization concerns. They must never be conflated.

### 1. Interface Localization

**What it is:** The language of the Abluo platform UI itself — admin dashboard labels, buttons, error messages, navigation, etc.

**Scope:** Platform-wide. Applies to all users of Abluo regardless of which tenant they belong to.

**Mechanism:** `next-intl` translation files in `/messages/` (e.g. `en.json`, `it.json`). The locale is determined by the URL prefix (`/en/`, `/it/`) and controlled by `src/i18n/routing.ts`.

**Who controls it:** The Abluo platform team (Tom). Adding a new interface language means adding a `messages/xx.json` file and adding the locale to `routing.ts`.

**TypeScript type:** `SupportedLocale` in `types.ts` — the union of all locales the platform UI is translated into.

---

### 2. Content Localization

**What it is:** The language(s) in which a tenant's website content is written — page text, blog posts, section copy, alt text, etc.

**Scope:** Per-tenant. Each tenant independently chooses which languages their site supports.

**Mechanism:** `siteConfig.supportedLocales` stored in Sanity per tenant. GROQ queries receive `$locale` and `$defaultLocale` as parameters and resolve content using `coalesce(field[$locale], field[$defaultLocale], field.en)`.

**Who controls it:** The Abluo admin, per client, in the `siteConfig` document for that tenant. The client's `LanguageSwitcher` component reads this prop — it renders only the locales the tenant has enabled.

**Schema:** `localizedString`, `localizedText`, and `localizedPortableText` shared types contain fields for every language the platform supports. Tenants only fill in the ones they use; unused fields are simply left empty.

---

### The Rule

> **Interface Localization = platform-wide, next-intl, `routing.ts`**
> **Content Localization = per-tenant, Sanity, `siteConfig.supportedLocales`**

Never derive one from the other. A tenant can publish content in German (`siteConfig.supportedLocales: ['en', 'de']`) even if the Abluo admin dashboard has no German UI translation. Conversely, the platform UI can support French without any tenant website being in French.

The set of locales in `routing.ts` must cover every content locale any tenant might use, because next-intl parses the URL prefix (`/de/tenant/...`) before the tenant config is fetched. If a locale appears in a tenant's `siteConfig.supportedLocales` but not in `routing.ts`, its URLs will 404.

---

## GitHub

Organization: `abluo-content-simplified`
- `abluo-platform` — main platform codebase
- `abluo-playground` — experiments and UI prototypes (never deployed)
