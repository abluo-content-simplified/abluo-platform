/**
 * Sanity GROQ queries for the Abluo platform.
 *
 * Rules:
 * - Every query MUST filter by projectSlug — no unscoped queries ever.
 * - Use `tenantClient('slug').fetchForTenant(query, params)` to execute.
 *   tenantClient resolves the URL tenant slug (e.g. "livener") to the
 *   Sanity projectSlug (e.g. "livener-main") and injects it as $projectSlug.
 *
 * Multilingual fields:
 * - Text fields are stored as { it: "...", en: "..." } objects in Sanity.
 * - GROQ resolves with locale-aware fallback chain:
 *     coalesce(field[$locale], field[$defaultLocale], field.en, field)
 *     → requested locale → tenant default → English → raw value
 * - $locale        = current UI locale (e.g. 'de')
 * - $defaultLocale = tenant's primary language from siteConfig (e.g. 'it' for Martegani)
 * - Components receive plain strings — unaware of localization internals.
 */

// The trailing `select(...)` is the legacy escape hatch: some older documents
// store a plain string where the schema now declares a localizedString. A plain
// string has no `_type` attribute, so it falls through and is returned as-is.
// A *localized object* always carries `_type`, so an object with no usable
// locale resolves to null rather than leaking `{_type: 'localizedString'}` into
// the render tree (React throws "Objects are not valid as a React child").
const loc = (field: string) =>
  `coalesce(${field}[$locale], ${field}[$defaultLocale], ${field}.en, select(!defined(${field}._type) => ${field}))`

const locImage = (field: string) => /* groq */ `
  ${field} {
    asset,
    hotspot,
    crop,
    "alt": ${loc('alt')},
    "caption": ${loc('caption')}
  }
`

// ─── navigationLink fragment ──────────────────────────────────────────────────
// Every field the navigationLink object type carries, locale-resolved, shaped
// to match NavLink in ./types.ts. Used by the footer column / credit
// projections added for the grouped footer. The existing navLinks[] and
// footerLinks[] projections keep their inline copies untouched.
const NAV_LINK_FIELDS = /* groq */ `
  "label": ${loc('label')},
  linkType,
  "pageSlug": coalesce(pageRef->slug[$locale].current, pageRef->slug[$defaultLocale].current),
  internalPage,
  externalUrl,
  anchorId,
  openInNewTab,
  href,
  external
`

// ─── Renderable form definition projection ────────────────────────────────────
// The field selection every surface that RENDERS a form needs: identity,
// version, localized copy, steps and fields, consent, and success copy. Shaped
// to match the RenderableFormDefinition type in ./types.ts.
//
// Extracted in ADR-020. This projection previously existed as six byte-identical
// inline copies — the contact section and form section (each duplicated across
// the homepage and slug-route section projections), the nav CTA form, and the
// WhatsApp form. Module config became a seventh consumer, at which point the
// duplication stopped being tolerable: a new field on formDefinition would have
// to be added in seven places, and missing one would make a form render
// differently depending on which surface loaded it.
//
// Interpolate inside a dereference:
//   "ctaForm": ctaForm->{ ${FORM_DEFINITION_PROJECTION} }
const FORM_DEFINITION_PROJECTION = /* groq */ `
_id,
formId,
formType,
version,
"title": ${loc('title')},
"eyebrow": ${loc('eyebrow')},
fullWidthButton,
reviewStep,
tenantSlug,
steps[]{
  key,
  "title": ${loc('title')},
  "description": ${loc('description')},
  fields[]{
    "id": internalKey,
    type,
    required,
    width,
    contextMappable,
    display,
    "label": ${loc('label')},
    "placeholder": ${loc('placeholder')},
    "help": ${loc('help')},
    minLength,
    maxLength,
    pattern,
    "patternMessage": ${loc('patternMessage')},
    options[]{ value, "label": ${loc('label')}, "description": ${loc('description')} }
  }
},
"requireConsent": privacy.requireConsent,
"consentText": ${loc('privacy.consentText')},
"successTitle": ${loc('success.title')},
"successBody": ${loc('success.body')}
`

// ─── CTA fields projection ────────────────────────────────────────────────────
// Reusable GROQ inline fragment for the cta object type.
// Include it in any section projection that uses a CTA field.
//
// Usage in a section query:
//   primaryCta { ${CTA_FIELDS} },
//   secondaryCta { ${CTA_FIELDS} },
//
// The fragment resolves all references so the frontend receives plain values —
// no Sanity reference objects, no URL construction needed.
export const CTA_FIELDS = /* groq */ `
  "label": ${loc('label')},
  internalName,
  actionType,
  "pageSlug": coalesce(
    pageRef->slug[$locale].current,
    pageRef->slug[$defaultLocale].current
  ),
  "formId": formRef->formId,
  "fileUrl": file.asset->url,
  "fileName": file.asset->originalFilename,
  externalUrl,
  openInNewTab,
  // Optional form pre-fill pairs (actionType == 'form'). Null on every CTA
  // authored before this field existed — those open the form unchanged.
  "context": context[]{ key, value }
`

// ─── Page sections[] projection ───────────────────────────────────────────────
// Single source of truth for the `sections[]` GROQ projection — every field
// any current section type (platform or module) can carry, locale-resolved
// via the same coalesce(field[$locale], field[$defaultLocale], field.en)
// chain as every other content field. Used verbatim (no divergent copies) by
// pageHomeQuery, pageBySlugQuery, and — as of ADR-016 Phase A — livePageQuery,
// eventsPageQuery, and blogPageQuery, so the three composable-page singletons
// project sections identically to a regular `page`. A new section field added
// here is available to every query below automatically.
//
// Emitted as a bare `sections[] { ... }` fragment (no leading/trailing comma)
// — call sites splice it in as a field alongside a document's other fields.
export const PAGE_SECTIONS_PROJECTION = /* groq */ `
    sections[] {
      _type,
      _key,
      background,
      // Optional authored DOM id — powers in-page "#anchor" links. Null on
      // every section that has never had one authored, which is every section
      // that predates this field.
      anchorId,
      "eyebrow": ${loc('eyebrow')},
      "headline": ${loc('headline')},
      // Optional per-section headline accent ('none' | 'lastWord'). Null on
      // every section authored before the field existed — the renderer treats
      // null exactly like 'none', so nothing changes for existing tenants.
      headlineAccent,
      "subheadline": ${loc('subheadline')},
      // heroSection extension — optional bold line between the subheadline and
      // the CTA row. Null on every section that has never had one authored
      // (which is every section type other than heroSection), so the renderer
      // simply renders nothing. treatmentCard's own nested "tagline" lives
      // inside the treatments[] sub-projection below and is untouched by this.
      "tagline": ${loc('tagline')},
      "ctaLabel": ${loc('ctaLabel')},
      ctaHref,
      "title": ${loc('title')},
      "body": ${loc('body')},
      // mediaContentSection fields — coalesce migrates old imagePosition data
      "mediaPosition": coalesce(mediaPosition, imagePosition),
      contentRatio,
      reverseOnMobile,
      mediaStyle,
      "primaryCta": primaryCta { ${CTA_FIELDS} },
      "secondaryCta": secondaryCta { ${CTA_FIELDS} },
      // statementSection fields
      "description": ${loc('description')},
      alignment,
      image { asset, hotspot, crop },
      "intro": ${loc('intro')},
      treatments[] {
        _type, _key,
        "name": ${loc('name')},
        "tagline": ${loc('tagline')},
        "description": ${loc('description')},
      },
      "subtitle": ${loc('subtitle')},
      members[] {
        _type, _key,
        photo { asset, hotspot, crop },
        name,
        "role": ${loc('role')},
        "bio": ${loc('bio')},
      },
      "content": ${loc('content')},
      items[] {
        _key,
        "question": ${loc('question')},
        "answer": ${loc('answer')},
      },
      showMap, mapHeight, mapTheme,
      // contactSection message button (overlay) — reuses the form projection
      "contactForm": contactForm->{
        ${FORM_DEFINITION_PROJECTION}
      },
      "contactButtonLabel": ${loc('contactButtonLabel')},
      "contactOverlayTitle": ${loc('contactOverlayTitle')},
      showWhatsappButton,
      // Blog listing section fields — null on all other section types
      filterMode,
      sortOrder,
      layout,
      maxItems,
      "viewAllLabel": ${loc('viewAllLabel')},
      viewAllHref,
      "categoryKey": categoryKey[0],
      "eventId": event->._id,
      "postIds": posts[]->._id,
      // newsListingSection fields — null on all other section types.
      // filterMode, sortOrder, layout, maxItems, viewAllLabel, viewAllHref and
      // categoryId above are shared field names, reused verbatim; only the
      // hand-picked array differs, since News picks newsArticle not post.
      "articleIds": articles[]->._id,
      // eventsListingSection fields — null on all other section types
      // (filterMode, sortOrder, layout, maxItems, viewAllLabel, viewAllHref,
      // categoryId above are shared field names, reused verbatim)
      timeFilter,
      "eventIds": events[]->._id,
      // Shared localized empty-state fields — blogListingSection,
      // eventsListingSection, liveLatestSection (ADR-016 Phase B)
      "emptyStateHeading": ${loc('emptyStateHeading')},
      "emptyStateBody": ${loc('emptyStateBody')},
      // formSection fields
      "definition": form->{
        ${FORM_DEFINITION_PROJECTION}
      },
      "context": context[]{ key, value },
      // formOverlayButtonSection fields (reuses "definition" + "context" above)
      "buttonLabel": ${loc('buttonLabel')},
      "overlayTitle": ${loc('overlayTitle')},
      buttonStyle,
      buttonAlign,
      buttonFullWidth,
      // heroSection media / layout / style fields
      mediaType,
      heroImage { asset, hotspot, crop },
      heroVideo,
      posterImage { asset, hotspot, crop },
      heroHeight,
      mediaLayout,
      contentWidth,
      contentAlignment,
      verticalAlignment,
      overlayOpacity,
      blur,
      brightness,
      // heroSection extension — 'onMedia' (default, today's white button over
      // media) | 'brand' (design-system button tokens). Null on every existing
      // hero, which the renderer treats exactly like 'onMedia'.
      ctaStyle,
      // heroLiveCaptureSection + heroLensSection CTA array
      ctas[] { ${CTA_FIELDS} },
      backgroundImage { asset, hotspot, crop },
      phoneScreenImage { asset, hotspot, crop },
      circleSize,
      animationIntensity,
      // heroLensSection fields
      foregroundImage { asset, hotspot, crop },
      // videoSection fields — eyebrow/title already projected generically above
      provider,
      videoId,
      videoUrl,
      "caption": ${loc('caption')},
      aspectRatio,
      // metricsSection fields
      metrics[] {
        _type, _key,
        "value": ${loc('value')},
        animateNumber,
        "label": ${loc('label')},
        "description": ${loc('description')},
      },
      // photoGallerySection fields
      columns,
      imageRatio,
      spacing,
      showCaptions,
      "gallery": gallery->{
        _id,
        internalName,
        "description": ${loc('description')},
        items[] {
          _key,
          titleOverrideEnabled,
          "titleOverride": select(titleOverrideEnabled == true => ${loc('titleOverride')}),
          captionOverrideEnabled,
          "captionOverride": select(captionOverrideEnabled == true => ${loc('captionOverride')}),
          "mediaAsset": mediaAsset->{
            _id,
            mediaType,
            image { asset, hotspot, crop },
            videoUrl,
            "altText": ${loc('altText')},
            "title": ${loc('title')},
            "caption": ${loc('caption')},
          }
        }
      },
      // ─── Platform sections added with the icon primitive ──────────────────
      // Every key below is NEW to this flat projection and resolves to null on
      // every section type that does not declare it. Fields these sections
      // share with existing ones (background, eyebrow, title, intro, body,
      // image, mediaPosition, contentRatio, mediaStyle, columns, primaryCta,
      // secondaryCta, ctas) are deliberately NOT re-added — they are projected
      // above and reused verbatim.
      //
      // stepsSection
      steps[] {
        _type, _key,
        icon,
        "title": ${loc('title')},
        "subtitle": ${loc('subtitle')},
        "description": ${loc('description')},
        "tags": tags[]{ "v": ${loc('@')} }.v,
      },
      "closingText": ${loc('closingText')},
      "closingCta": closingCta { ${CTA_FIELDS} },
      // featureGridSection (columns is the shared key already projected above)
      variant,
      "chips": chips[]{ "v": ${loc('@')} }.v,
      // SHARED "features[]" KEY — featureGridSection stores featureCard members
      // (icon/kicker/title/description/bullets) and mediaFeatureSection stores
      // featureRow members (icon/title/description) under the same field name.
      // One sub-projection naming the union of both serves both: GROQ returns
      // null for a key the concrete member does not have, so a featureRow just
      // comes back with kicker/bullets null. Do not split these into two keys
      // without renaming the field in one of the two schemas + components.
      features[] {
        _type, _key,
        icon,
        "kicker": ${loc('kicker')},
        "title": ${loc('title')},
        "description": ${loc('description')},
        "bullets": bullets[]{ "v": ${loc('@')} }.v,
        // featureRow only (mediaFeatureSection). Null for every featureCard
        // and for every featureRow authored before the field existed.
        ${locImage('image')},
      },
      // mediaFeatureSection
      interactiveMedia,
      mockupFrame,
      "mockupTitle": ${loc('mockupTitle')},
      "mockupBadge": ${loc('mockupBadge')},
      "closingLine": ${loc('closingLine')},
      // categoryListSection — "categories" and its nested "items" are scoped
      // inside this section's own sub-projections, so the top-level items[]
      // (faqSection) above is untouched.
      "headerCta": headerCta { ${CTA_FIELDS} },
      categories[] {
        _type, _key,
        "label": ${loc('label')},
        "items": items[] {
          _key,
          "text": ${loc('@')},
        },
      },
      callout {
        icon,
        "title": ${loc('title')},
        "description": ${loc('description')},
        "cta": cta { ${CTA_FIELDS} },
      },
      // ctaBannerSection — "heading" is a DIFFERENT field from the existing
      // "headline" above; the two must never be merged.
      "heading": ${loc('heading')},
      "footnote": ${loc('footnote')},
      "footnoteAccent": ${loc('footnoteAccent')},
      "watermarkText": ${loc('watermarkText')},
      showGlow,
      // heroSection extension — optional stat row. "ctas[]" is already
      // projected above (heroLiveCapture / heroLens) and is reused verbatim.
      stats[] {
        _type, _key,
        "value": ${loc('value')},
        "label": ${loc('label')},
      }
    }
`

export const localeConfigQuery = /* groq */ `
  *[_type == "siteConfig" && projectSlug == $projectSlug][0] {
    defaultLocale,
    supportedLocales
  }
`

// ─── Favicon-only query (no locale params needed) ─────────────────────────────
// Used by generateMetadata in the tenant layout. Fetches only the identity
// fields from siteConfig for <head> metadata (favicon, OG image, apple-touch).
// Precedence: siteConfig.faviconSvg → siteConfig.faviconPng → /favicon.ico.
export const siteConfigFaviconQuery = /* groq */ `
  *[_type == "siteConfig" && projectSlug == $projectSlug][0] {
    faviconSvg { asset },
    faviconPng { asset },
    openGraphImage { asset },
    appleTouchIcon { asset },
    "googleSiteVerification": googleSiteVerification,
    "bingSiteVerification": bingSiteVerification
  }
`

export const websiteSiteConfigQuery = /* groq */ `
  *[_type == "siteConfig" && projectSlug == $projectSlug][0] {
    projectSlug,
    siteName,
    defaultLocale,
    supportedLocales,
    showLangSwitcherInNav,
    "tagline": ${loc('tagline')},
    ${locImage('logo')},
    ${locImage('logoLight')},
    // Text wordmark — drawn in the heading font when no logo image is set.
    // Null on every tenant that has not authored one.
    "wordmarkText": ${loc('wordmarkText')},
    wordmarkAccent,
    backgroundGraphic {
      enabled,
      ${locImage('asset')},
      opacity,
      scale,
      mobileScale,
      rotation,
      positionPreset,
      offsetX,
      offsetY,
      mobileOffsetX,
      mobileOffsetY,
      scrollBehavior,
      scope
    },
    headerAppearance {
      stickyHeader,
      initialStyle,
      scrolledStyle,
      backgroundOpacity,
      blurEffect,
      shadow,
      headerHeight,
      customHeight,
      zIndex,
      borderStyle
    },
    languageSwitcherPlacement,
    themeMode,
    themeSwitcherPlacement,
    navLinks[] {
      "label": ${loc('label')},
      linkType,
      "pageSlug": coalesce(pageRef->slug[$locale].current, pageRef->slug[$defaultLocale].current),
      internalPage,
      externalUrl,
      anchorId,
      openInNewTab,
      href,
      external,
      children[] {
        "label": ${loc('label')},
        linkType,
        "pageSlug": coalesce(pageRef->slug[$locale].current, pageRef->slug[$defaultLocale].current),
        internalPage,
        externalUrl,
        anchorId,
        openInNewTab,
        href,
        external
      }
    },
    // Header button. CTA_FIELDS gives label / action / internalName / targets;
    // the overlay additionally needs the whole definition, not just its id.
    headerCta {
      ${CTA_FIELDS},
      // NOT tenant-scoped, and cannot be from inside this query. A
      // formDefinition is scoped by tenantSlug, not projectSlug (forms
      // belong to the client, so two websites of one client share them), and
      // this query is only ever given $projectSlug — fetchForTenant injects
      // nothing else. The two ways to derive the tenant inside GROQ are both
      // wrong to rely on:
      //   • project.clientRef->tenantSlug — demonstrably diverges in the live
      //     dataset (project "nologo" has clientRef->tenantSlug "freeriders"
      //     while its own header form carries tenantSlug "nologo"), so this
      //     filter would blank out a working header CTA.
      //   • stripping a trailing "-main" off $projectSlug — the Studio's own
      //     heuristic (schema.ts formRef filter), but a naming convention, not
      //     a guarantee; encoding it here makes a security boundary out of a
      //     string suffix.
      // The real fix is a $tenantSlug parameter injected alongside $projectSlug
      // by fetchForTenant (client.ts), then && tenantSlug == $tenantSlug on a
      // filtered subquery in place of this dereference. Until that parameter
      // exists, a cross-tenant headerCta.formRef still resolves.
      "form": formRef->{ ${FORM_DEFINITION_PROJECTION} }
    },
    "ctaLabel": ${loc('ctaLabel')},
    ctaHref,
    footerLinks[] {
      "label": ${loc('label')},
      linkType,
      internalPage,
      externalUrl,
      anchorId,
      openInNewTab,
      href,
      external
    },
    // Grouped footer link columns — empty on every tenant that has not
    // authored any, leaving the flat footerLinks[] above the only source.
    footerColumns[] {
      _key,
      "heading": ${loc('heading')},
      links[] { ${NAV_LINK_FIELDS} }
    },
    "footerSubTagline": ${loc('footerSubTagline')},
    footerCredit { ${NAV_LINK_FIELDS} },
    "footerCtaHeading": ${loc('footerCtaHeading')},
    "footerCtaSubtext": ${loc('footerCtaSubtext')},
    "footerCtaInputPlaceholder": ${loc('footerCtaInputPlaceholder')},
    "footerCtaButtonLabel": ${loc('footerCtaButtonLabel')},
    legalName,
    legalAddress,
    registrationInfo,
    foundedYear,
    youtubeChannelUrl,
    socialLinks[] { platform, url },
    phone,
    email,
    whatsappNumber,
    whatsappFloating,
    "whatsappForm": whatsappForm->{
      ${FORM_DEFINITION_PROJECTION}
    },
    location { street, postalCode, city, state, country },
    address,
    openGraphImage { asset },
    logoHeightDesktop,
    logoHeightMobile,
    "seoDefaultTitle": ${loc('seoDefaultTitle')},
    "seoDefaultDescription": ${loc('seoDefaultDescription')},
    "customDomain": *[_type == "project" && projectSlug == $projectSlug && defined(customDomain)][0].customDomain
  }
`

// ─── Minimal query for canonical URL resolution ───────────────────────────────
// Used by generateMetadata in pages that don't fetch websiteSiteConfigQuery
// (blog/[slug], events/[slug], live). Source of truth: project.customDomain,
// synced from Supabase via ProjectLinker.
export const projectDomainQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug && defined(customDomain)][0].customDomain
`

// ─── Runtime integration configuration (ADR-014 Phase C) ──────────────────────
// Source of truth for tracking/analytics runtime behavior: project.integrationConfigs
// (the Integration Registry, ADR-014 Phase A) and project.privacy (Phase B). Replaces
// the removed siteConfig.integrations block — no compatibility layer, per Tom's
// explicit rule (the old model was already removed from the schema in Phase B).
// Consumed by TrackingScripts.tsx via fetchForTenant, same pattern as projectDomainQuery.
export const projectIntegrationsQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug][0] {
    integrationConfigs[] { integrationId, enabled, values },
    privacy { consentModeEnabled, trackingKillSwitch }
  }
`

// ─── Enabled module IDs (ADR-016 Phase D → ADR-020) ───────────────────────────
// Single source of truth for a website's installed-module set at render time.
// Mirrors the exact projection used for Studio nav in sanity.config.ts (the
// "enabledModuleIds" projection there) — do not fork this logic into a second
// shape.
//
// ADR-020 retired the legacy `enabledModules` fallback: migration 004
// backfilled typed installation records, so moduleInstallations is now the only
// source. A website with no installations resolves to [] — a real, resolved
// "no modules installed", which isSectionTypeAvailable() treats as gating ON
// (distinct from an unresolved null, which fails open). Returns the array
// directly (not wrapped in an object) via the trailing dot-projection.
//
// Consumed by hydrateSections/SectionRenderer via fetchForTenant, same pattern
// as projectDomainQuery / projectIntegrationsQuery.
export const enabledModuleIdsQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug][0] {
    "enabledModuleIds": coalesce(moduleInstallations[enabled != false].moduleId, [])
  }.enabledModuleIds
`

// ─── Runtime module configuration (ADR-020 Decision 2) ────────────────────────
// Source of truth for module-owned per-website settings at render time:
// project.moduleInstallations[].config.
//
// Only ENABLED installations are projected. A disabled module must not have its
// configuration take effect — that is what disabling means — so the gate lives
// here in the query rather than being re-checked by every consumer.
//
// Reference-typed config fields are dereferenced into the shape their consumer
// renders. Both of the reference fields any module declares today point at a
// formDefinition, so both use FORM_DEFINITION_PROJECTION — the same projection
// every other form-rendering surface uses, which is precisely why it was
// extracted rather than copied a seventh time.
//
// The projection names config fields explicitly (not a wildcard) because GROQ
// cannot dereference a field it does not name. A module that adds a reference
// config field must add it here too; a module that adds a plain scalar field is
// covered by the `config` spread. This is the one place where the generated
// schema and the runtime read have to be kept in step.
//
// Consumed by the tenant layout and ContactSection via fetchForTenant, same
// pattern as projectIntegrationsQuery / enabledModuleIdsQuery.
export const projectModuleConfigQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug][0] {
    "modules": moduleInstallations[enabled != false] {
      moduleId,
      version,
      "config": config {
        ...,
        "whatsappForm": whatsappForm->{ ${FORM_DEFINITION_PROJECTION} },
        "internalFormRef": internalFormRef->{ ${FORM_DEFINITION_PROJECTION} },
        "ctaForm": ctaForm->{ ${FORM_DEFINITION_PROJECTION} }
      }
    }
  }.modules
`

export const postsQuery = /* groq */ `
  *[
    _type == "post"
    && projectSlug == $projectSlug
    && defined(publishedAt)
    && publishedAt <= now()
    && (!defined(expiresAt) || expiresAt > now())
  ]
  | order(featured desc, publishedAt desc) [$offset...$offset + $limit] {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    "excerpt": ${loc('excerpt')},
    publishedAt,
    expiresAt,
    featured,
    ${locImage('coverImage')},
    "readingTimeMinutes": math::max([1, round(
      length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / $charsPerMinute
    )]),
    "author": author-> {
      name,
      "role": ${loc('role')},
      avatar { asset, hotspot, crop }
    },
    "categoryKeys": categories,
    "categoryTitles": categories[]->title.en,
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
  }
`

// ─── Dashboard posts (ADR-017 slice 6 / ADR-015 close-out) ────────────────────
// The client dashboard's posts list. UNLIKE postsQuery (the PUBLIC website
// list, which filters `defined(publishedAt) && publishedAt <= now()`), this
// query returns ALL posts for the project regardless of publish state — the
// client needs to see drafts and scheduled posts they haven't published yet.
//
// A `status` field is derived so the dashboard can label each row without a
// second pass: "published" when publishedAt is set and in the past, otherwise
// "draft" (covers both never-published and future-scheduled posts). Ordered by
// most-recently-touched first (publishedAt when set, else _updatedAt).
//
// Executed ONLY through tenantScopedSanityClient (getDashboardPosts), which
// forces $projectSlug from the caller's ProjectGrant — this query references
// $projectSlug (required by the chokepoint's assertQueryIsTenantScoped guard)
// and never interpolates tenant identity.
export const dashboardPostsQuery = /* groq */ `
  *[_type == "post" && projectSlug == $projectSlug]
  | order(coalesce(publishedAt, _updatedAt) desc) {
    _id,
    "title": ${loc('title')},
    "slug": coalesce(slug[$locale].current, slug[$defaultLocale].current),
    "status": select(
      defined(publishedAt) && publishedAt <= now() => "published",
      "draft"
    ),
    "updatedAt": _updatedAt
  }
`

export const postBySlugQuery = /* groq */ `
  *[_type == "post" && projectSlug == $projectSlug && slug[$locale].current == $slug][0] {
    _id,
    "title": ${loc('title')},
    "slugMap": slug,
    "redirectFrom": redirectFrom,
    "excerpt": ${loc('excerpt')},
    "body": ${loc('body')},
    publishedAt,
    featured,
    ${locImage('coverImage')},
    featuredVideo {
      provider,
      youtubeUrl,
      cloudflareVideoId
    },
    "readingTimeMinutes": math::max([1, round(
      length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / $charsPerMinute
    )]),
    "author": author-> {
      _id,
      name,
      "role": ${loc('role')},
      "bio": ${loc('bio')},
      avatar { asset, hotspot, crop }
    },
    "categoryKeys": categories,
    "categoryTitles": categories[]->title.en,
    "relatedEvent": relatedEvent-> {
      _id,
      "title": ${loc('title')},
      "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
      status,
      startDate,
      endDate,
      "location": ${loc('location')},
      "shortDescription": ${loc('shortDescription')},
      ${locImage('heroImage')}
    },
    "seoTitle": coalesce(${loc('seoTitle')}, ${loc('title')}),
    "seoDescription": coalesce(${loc('seoDescription')}, ${loc('excerpt')}),
    seoImage { asset, hotspot, crop },
  }
`

export const postByOldSlugQuery = /* groq */ `
  *[_type == "post" && projectSlug == $projectSlug && $slug in redirectFrom[$locale]][0] {
    "currentSlug": slug[$locale].current
  }
`

// Fetches up to 3 related posts for the blog detail page.
// Prioritises posts that share at least one category with the current post,
// then falls back to featured / most recent from the same project.
// $excludeId prevents the current post from appearing in the results.
// $categoryKeys is the array of category keys on the current post.
export const relatedPostsQuery = /* groq */ `
  *[
    _type == "post"
    && projectSlug == $projectSlug
    && _id != $excludeId
    && defined(publishedAt)
    && publishedAt <= now()
    && (!defined(expiresAt) || expiresAt > now())
  ] | order(
    count(categories[@ in $categoryKeys]) desc,
    count(categories[]->title.en[@ in $categoryKeys]) desc,
    featured desc,
    publishedAt desc
  ) [0...3] {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    "excerpt": ${loc('excerpt')},
    publishedAt,
    featured,
    ${locImage('coverImage')},
    "readingTimeMinutes": math::max([1, round(
      length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / $charsPerMinute
    )]),
    "author": author-> {
      name,
      "role": ${loc('role')},
      avatar { asset, hotspot, crop }
    },
    "categoryKeys": categories,
    "categoryTitles": categories[]->title.en
  }
`

// ─── Blog Listing Section ─────────────────────────────────────────────────────
//
// Shared post card fields used by the blog listing section component.
// Separate query exports for each sort order — GROQ does not support
// dynamic sort direction via parameters, so we select the right query
// in the page server component based on section.sortOrder.

const blogListingCardFields = /* groq */ `
  _id,
  "title": coalesce(title[$locale], title[$defaultLocale], title.en, title),
  "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
  "excerpt": coalesce(excerpt[$locale], excerpt[$defaultLocale], excerpt.en, excerpt),
  publishedAt,
  featured,
  coverImage {
    asset,
    hotspot,
    crop,
    "alt": coalesce(alt[$locale], alt[$defaultLocale], alt.en, alt),
    "caption": coalesce(caption[$locale], caption[$defaultLocale], caption.en, caption)
  },
  "readingTimeMinutes": math::max([1, round(
    length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / $charsPerMinute
  )]),
  "author": author-> {
    name,
    "role": coalesce(role[$locale], role[$defaultLocale], role.en, role),
    avatar { asset, hotspot, crop }
  },
  "categoryKeys": categories,
  "categoryTitles": categories[]->title.en
`

// Core filter — applied by all three blog listing queries.
// filterMode is injected as a GROQ parameter. Conditional logic:
//   latest       → no extra filter
//   featured     → featured == true
//   byCategory   → $categoryId in categories[]._ref
//   byEvent      → relatedEvent._ref == $eventId
const blogListingFilter = /* groq */ `
  _type == "post"
  && projectSlug == $projectSlug
  && defined(publishedAt)
  && publishedAt <= now()
  && (!defined(expiresAt) || expiresAt > now())
  && (
    $filterMode == "latest"
    || ($filterMode == "featured" && featured == true)
    || ($filterMode == "byCategory" && ($categoryKey in categories || $categoryKey in categories[]->title.en))
    || ($filterMode == "byEvent" && relatedEvent._ref == $eventId)
  )
`

// Fetch up to $maxItems posts — newest first.
// Also fetches one extra ($maxItems + 1) so the page component can detect
// whether a "View All" button is warranted without a separate count query.
export const blogListingPostsNewestQuery = /* groq */ `
  *[${blogListingFilter}]
  | order(featured desc, publishedAt desc)
  [0...$maxItems] { ${blogListingCardFields} }
`

// Oldest first variant (identical filter, ascending sort).
export const blogListingPostsOldestQuery = /* groq */ `
  *[${blogListingFilter}]
  | order(publishedAt asc)
  [0...$maxItems] { ${blogListingCardFields} }
`

// Manual selection — fetch by explicit post IDs.
// The page component re-orders the result to match the original $postIds array order.
//
// projectSlug is asserted even though the IDs come from a tenant-scoped
// document: every tenant query filters by projectSlug (CLAUDE.md), and without
// it a stale or hand-edited reference to another tenant's post would resolve.
export const blogListingManualPostsQuery = /* groq */ `
  *[_type == "post" && projectSlug == $projectSlug && _id in $postIds] {
    ${blogListingCardFields}
  }
`

// ─── News module queries (ADR-020) ────────────────────────────────────────────
//
// Mirrors the Blog query set. Two structural differences, both following from
// the News content model rather than from copying less carefully:
//   • no author projection — a news item has no byline
//   • no 'byEvent' filter mode — News integrates with no other module
//
// newsArticle is a routable type, so it carries the three queries the Publicly
// Routable Content Pattern requires (CLAUDE.md): a primary lookup with NO
// locale fallback on the slug, a redirect lookup, and list queries that DO
// resolve the slug with a fallback for display.

const newsListingCardFields = /* groq */ `
  _id,
  "title": ${loc('title')},
  "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
  "excerpt": ${loc('excerpt')},
  publishedAt,
  featured,
  ${locImage('coverImage')},
  "readingTimeMinutes": math::max([1, round(
    length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / $charsPerMinute
  )]),
  "categoryKeys": categories,
  "categoryTitles": categories[]->title.en
`

// Core filter — applied by the newest/oldest listing queries.
//   latest     → no extra filter
//   featured   → featured == true
//   byCategory → $categoryId in categories[]._ref
//
// Unpublished and expired items are excluded here rather than in the component,
// so an expired announcement cannot leak through any consumer.
const newsListingFilter = /* groq */ `
  _type == "newsArticle"
  && projectSlug == $projectSlug
  && defined(publishedAt)
  && publishedAt <= now()
  && (!defined(expiresAt) || expiresAt > now())
  && (
    $filterMode == "latest"
    || ($filterMode == "featured" && featured == true)
    || ($filterMode == "byCategory" && ($categoryKey in categories || $categoryKey in categories[]->title.en))
  )
`

export const newsListingArticlesNewestQuery = /* groq */ `
  *[${newsListingFilter}]
  | order(featured desc, publishedAt desc)
  [0...$maxItems] { ${newsListingCardFields} }
`

export const newsListingArticlesOldestQuery = /* groq */ `
  *[${newsListingFilter}]
  | order(publishedAt asc)
  [0...$maxItems] { ${newsListingCardFields} }
`

// Manual selection — fetch by explicit IDs. The consumer re-orders the result
// to match the original $articleIds order, which GROQ does not preserve.
//
// projectSlug is asserted even though the IDs come from a tenant-scoped
// document: every tenant query filters by projectSlug (CLAUDE.md), and without
// it a stale or hand-edited reference to another tenant's item would resolve.
export const newsListingManualArticlesQuery = /* groq */ `
  *[_type == "newsArticle" && projectSlug == $projectSlug && _id in $articleIds] {
    ${newsListingCardFields}
  }
`

// Paged list — the /news index route.
export const newsArticlesQuery = /* groq */ `
  *[
    _type == "newsArticle"
    && projectSlug == $projectSlug
    && defined(publishedAt)
    && publishedAt <= now()
    && (!defined(expiresAt) || expiresAt > now())
  ]
  | order(featured desc, publishedAt desc) [$offset...$offset + $limit] {
    ${newsListingCardFields},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
  }
`

// Primary lookup — deliberately NO locale fallback on the slug.
// Requirement 2 of the Publicly Routable Content Pattern: an Italian URL must
// not resolve an English slug, or two locales would serve the same content at
// two URLs and compete in search.
export const newsArticleBySlugQuery = /* groq */ `
  *[_type == "newsArticle" && projectSlug == $projectSlug && slug[$locale].current == $slug][0] {
    _id,
    "title": ${loc('title')},
    "slugMap": slug,
    "redirectFrom": redirectFrom,
    "excerpt": ${loc('excerpt')},
    "body": ${loc('body')},
    publishedAt,
    expiresAt,
    featured,
    ${locImage('coverImage')},
    "readingTimeMinutes": math::max([1, round(
      length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / $charsPerMinute
    )]),
    "categoryKeys": categories,
    "categoryTitles": categories[]->title.en,
    "seoTitle": coalesce(${loc('seoTitle')}, ${loc('title')}),
    "seoDescription": coalesce(${loc('seoDescription')}, ${loc('excerpt')}),
    seoImage { asset, hotspot, crop },
  }
`

// Redirect lookup — resolves an old slug to the current one for a 301.
export const newsArticleByOldSlugQuery = /* groq */ `
  *[_type == "newsArticle" && projectSlug == $projectSlug && $slug in redirectFrom[$locale]][0] {
    "currentSlug": slug[$locale].current
  }
`

// News singleton page — hero, SEO, and composed sections.
export const newsPageQuery = /* groq */ `
  *[_type == "newsPage" && projectSlug == $projectSlug][0] {
    _id,
    "heroTitle": ${loc('heroTitle')},
    "heroSubtitle": ${loc('heroSubtitle')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
    ${PAGE_SECTIONS_PROJECTION}
  }
`

// ─── Events Listing Section (ADR-016 Phase B, 'live' added Phase C) ───────────
//
// Modeled on the Blog Listing Section queries above. Adds a $timeFilter
// parameter (upcoming / live / past / all) compared against event.startDate /
// event.status — events carry a date + status dimension blog posts don't.
//
// Consumers (frontend-sections, hydrateSections): pick the query matching
// section.sortOrder exactly as blogListing* is picked today. Params required
// on all three: projectSlug (injected by fetchForTenant), locale,
// defaultLocale, maxItems, timeFilter, filterMode, and — depending on
// filterMode — categoryId (byCategory) or eventIds (manual, via the
// *Manual* query's $eventIds).

const eventsListingCardFields = /* groq */ `
  _id,
  "title": coalesce(title[$locale], title[$defaultLocale], title.en, title),
  "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
  status,
  startDate,
  endDate,
  "location": coalesce(location[$locale], location[$defaultLocale], location.en, location),
  "shortDescription": coalesce(shortDescription[$locale], shortDescription[$defaultLocale], shortDescription.en, shortDescription),
  heroImage {
    asset,
    hotspot,
    crop,
    "alt": coalesce(alt[$locale], alt[$defaultLocale], alt.en, alt),
    "caption": coalesce(caption[$locale], caption[$defaultLocale], caption.en, caption)
  },
  "categoryKeys": categories,
  "categoryTitles": categories[]->title.en
`

// Core filter — applied by all three eventsListing queries.
// $timeFilter and $filterMode are injected as GROQ parameters.
//   timeFilter: upcoming → startDate >= now() | live → status == "live" (mirrors
//               additionalLiveEventsQuery/currentLiveEventQuery's live-status
//               check, including the endDate guard) | past → startDate < now()
//               | all → no restriction
//   filterMode: latest → no extra filter | featured → featuredOnHomePage == true
//               | byCategory → $categoryId in categories[]._ref
//
// ADR-016 Phase C — 'live' added so eventsListingSection can reproduce the
// livePage "More Live Productions" block. Unlike additionalLiveEventsQuery,
// this does NOT exclude any particular event (e.g. the one a co-located
// liveLatestSection is showing) — a generic section has no way to know what
// another section selected. See schema.ts eventsListingSectionType comment
// for the accepted parity delta.
const eventsListingFilter = /* groq */ `
  _type == "event"
  && projectSlug == $projectSlug
  && (
    $timeFilter == "all"
    || ($timeFilter == "upcoming" && startDate >= now())
    || ($timeFilter == "live" && status == "live" && (endDate == null || now() <= endDate))
    || ($timeFilter == "past" && startDate < now())
  )
  && (
    $filterMode == "latest"
    || ($filterMode == "featured" && featuredOnHomePage == true)
    || ($filterMode == "byCategory" && ($categoryKey in categories || $categoryKey in categories[]->title.en))
  )
`

// Fetch up to $maxItems events — newest (soonest/most-recent) first.
// Also fetches one extra ($maxItems + 1) so the page component can detect
// whether a "View All" button is warranted, matching the blogListing pattern.
export const eventsListingEventsNewestQuery = /* groq */ `
  *[${eventsListingFilter}]
  | order(startDate desc)
  [0...$maxItems] { ${eventsListingCardFields} }
`

// Oldest first variant (identical filter, ascending sort by startDate).
export const eventsListingEventsOldestQuery = /* groq */ `
  *[${eventsListingFilter}]
  | order(startDate asc)
  [0...$maxItems] { ${eventsListingCardFields} }
`

// Manual selection — fetch by explicit event IDs.
// The page component re-orders the result to match the original $eventIds array order.
//
// projectSlug is asserted even though the IDs come from a tenant-scoped
// document: every tenant query filters by projectSlug (CLAUDE.md), and without
// it a stale or hand-edited reference to another tenant's event would resolve.
export const eventsListingManualEventsQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && _id in $eventIds] {
    ${eventsListingCardFields}
  }
`

export const currentLiveEventQuery = /* groq */ `
  coalesce(
    // Explicitly featured on live page, within optional scheduling window
    *[
      _type == "event"
      && projectSlug == $projectSlug
      && (featuredOnLivePage == true || isCurrentLiveEvent == true)
      && (livePageFeatureStartDate == null || now() >= livePageFeatureStartDate)
      && (livePageFeatureEndDate == null || now() <= livePageFeatureEndDate)
      && (endDate == null || now() <= endDate)
    ][0],
    // Fallback: any live-status event
    *[_type == "event" && projectSlug == $projectSlug && status == "live" && (endDate == null || now() <= endDate)][0],
    // Fallback: next upcoming event
    *[_type == "event" && projectSlug == $projectSlug && status == "upcoming" && now() < startDate]
      | order(startDate asc)[0]
  ) {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    status,
    featuredOnLivePage,
    isCurrentLiveEvent,
    startDate,
    endDate,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    "fullDescription": ${loc('fullDescription')},
    ${locImage('heroImage')},
    schedule[] {
      _key,
      time,
      "title": ${loc('title')},
      "description": ${loc('description')}
    },
    embedPlayerEnabled,
    embedVideoUrl,
    "primaryStreamLabel": ${loc('primaryStreamLabel')},
    primaryStreamUrl,
    "secondaryStreamLabel": ${loc('secondaryStreamLabel')},
    secondaryStreamUrl,
    youtubeChannelUrl,
    youtubeUrl,
    "ctaLabel": ${loc('ctaLabel')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')}
  }
`

// ─── Homepage Featured Event ───────────────────────────────────────────────────
// Returns the single active homepage-featured event, or null if none qualifies.
// Sorting: live events first, then upcoming by nearest start date.
const homepageFeaturedEventFields = /* groq */ `
  _id,
  "title": ${loc('title')},
  "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
  status,
  featuredOnHomePage,
  startDate,
  endDate,
  "location": ${loc('location')},
  "shortDescription": ${loc('shortDescription')},
  ${locImage('heroImage')},
  "primaryStreamLabel": ${loc('primaryStreamLabel')},
  primaryStreamUrl,
  "secondaryStreamLabel": ${loc('secondaryStreamLabel')},
  secondaryStreamUrl,
  youtubeUrl,
  "ctaLabel": ${loc('ctaLabel')}
`

export const homepageFeaturedEventQuery = /* groq */ `
  coalesce(
    // Live events that are featured on homepage (within date window)
    *[
      _type == "event"
      && projectSlug == $projectSlug
      && featuredOnHomePage == true
      && status == "live"
      && (homePageFeatureStartDate == null || now() >= homePageFeatureStartDate)
      && (homePageFeatureEndDate == null || now() <= homePageFeatureEndDate)
    ] | order(startDate asc)[0] { ${homepageFeaturedEventFields} },
    // Upcoming events that are featured on homepage (within date window)
    *[
      _type == "event"
      && projectSlug == $projectSlug
      && featuredOnHomePage == true
      && status == "upcoming"
      && (homePageFeatureStartDate == null || now() >= homePageFeatureStartDate)
      && (homePageFeatureEndDate == null || now() <= homePageFeatureEndDate)
    ] | order(startDate asc)[0] { ${homepageFeaturedEventFields} }
  )
`

export const eventsQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug]
  | order(startDate desc) {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    status,
    startDate,
    endDate,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    ${locImage('heroImage')},
    youtubeChannelUrl
  }
`

export const pastEventsQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && (status == "past" || now() > endDate)]
  | order(startDate desc) [0..4] {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    status,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    ${locImage('heroImage')},
    startDate,
    endDate
  }
`

// Additional live events — all events with status "live" except the featured one.
// $featuredEventId should be the _id of the currently featured live event (or "" if none).
export const additionalLiveEventsQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && status == "live" && _id != $featuredEventId && (endDate == null || now() <= endDate)]
  | order(startDate asc) {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    status,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    ${locImage('heroImage')},
    startDate,
    endDate
  }
`

export const eventByOldSlugQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && $slug in redirectFrom[$locale]][0] {
    "currentSlug": slug[$locale].current
  }
`

export const eventBySlugQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && slug[$locale].current == $slug][0] {
    _id,
    "title": ${loc('title')},
    "slugMap": slug,
    "redirectFrom": redirectFrom,
    status,
    featuredOnLivePage,
    isCurrentLiveEvent,
    featuredOnHomePage,
    homePageFeatureStartDate,
    homePageFeatureEndDate,
    startDate,
    endDate,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    "fullDescription": ${loc('fullDescription')},
    ${locImage('heroImage')},
    gallery[] {
      asset,
      hotspot,
      crop,
      "alt": ${loc('alt')},
      "caption": ${loc('caption')}
    },
    schedule[] {
      _key,
      time,
      "title": ${loc('title')},
      "description": ${loc('description')}
    },
    embedPlayerEnabled,
    embedVideoUrl,
    "primaryStreamLabel": ${loc('primaryStreamLabel')},
    primaryStreamUrl,
    "secondaryStreamLabel": ${loc('secondaryStreamLabel')},
    secondaryStreamUrl,
    youtubeChannelUrl,
    youtubeUrl,
    "ctaLabel": ${loc('ctaLabel')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')}
  }
`

// Legacy — kept for backward compat. New tenants use pageHomeQuery below.
export const homePageQuery = /* groq */ `
  *[_type == "homePage" && projectSlug == $projectSlug][0] {
    projectSlug,
    backgroundPattern,
    sections[] {
      _type,
      _key,
      background,
      // Optional authored DOM id — powers in-page "#anchor" links. Null on
      // every section that has never had one authored, which is every section
      // that predates this field.
      anchorId,
      "eyebrow": ${loc('eyebrow')},
      "headline": ${loc('headline')},
      // Optional per-section headline accent — see PAGE_SECTIONS_PROJECTION.
      headlineAccent,
      "subheadline": ${loc('subheadline')},
      "ctaLabel": ${loc('ctaLabel')},
      ctaHref,
      "title": ${loc('title')},
      "body": ${loc('body')},
      // mediaContentSection fields — coalesce migrates old imagePosition data
      "mediaPosition": coalesce(mediaPosition, imagePosition),
      contentRatio,
      reverseOnMobile,
      mediaStyle,
      "primaryCta": primaryCta { ${CTA_FIELDS} },
      "secondaryCta": secondaryCta { ${CTA_FIELDS} },
      // statementSection fields
      "description": ${loc('description')},
      alignment,
      image { asset, hotspot, crop },
      "intro": ${loc('intro')},
      treatments[] {
        _type, _key,
        "name": ${loc('name')},
        "tagline": ${loc('tagline')},
        "description": ${loc('description')},
      },
      "subtitle": ${loc('subtitle')},
      members[] {
        _type, _key,
        photo { asset, hotspot, crop },
        name,
        "role": ${loc('role')},
        "bio": ${loc('bio')},
      },
      "content": ${loc('content')},
      items[] {
        _key,
        "question": ${loc('question')},
        "answer": ${loc('answer')},
      },
      showMap, mapHeight, mapTheme,
      // contactSection message button (overlay) — reuses the form projection
      "contactForm": contactForm->{
        ${FORM_DEFINITION_PROJECTION}
      },
      "contactButtonLabel": ${loc('contactButtonLabel')},
      "contactOverlayTitle": ${loc('contactOverlayTitle')},
      showWhatsappButton,
      "definition": form->{
        ${FORM_DEFINITION_PROJECTION}
      },
      "context": context[]{ key, value },
      // formOverlayButtonSection fields (reuses "definition" + "context" above)
      "buttonLabel": ${loc('buttonLabel')},
      "overlayTitle": ${loc('overlayTitle')},
      buttonStyle,
      buttonAlign,
      buttonFullWidth,
      // heroSection media / layout / style fields
      mediaType,
      heroImage { asset, hotspot, crop },
      heroVideo,
      posterImage { asset, hotspot, crop },
      heroHeight,
      mediaLayout,
      contentWidth,
      contentAlignment,
      verticalAlignment,
      overlayOpacity,
      blur,
      brightness,
      // metricsSection fields
      metrics[] {
        _type, _key,
        "value": ${loc('value')},
        animateNumber,
        "label": ${loc('label')},
        "description": ${loc('description')},
      },
      // photoGallerySection fields
      columns,
      imageRatio,
      spacing,
      showCaptions,
      "gallery": gallery->{
        _id,
        internalName,
        "description": ${loc('description')},
        items[] {
          _key,
          titleOverrideEnabled,
          "titleOverride": select(titleOverrideEnabled == true => ${loc('titleOverride')}),
          captionOverrideEnabled,
          "captionOverride": select(captionOverrideEnabled == true => ${loc('captionOverride')}),
          "mediaAsset": mediaAsset->{
            _id,
            mediaType,
            image { asset, hotspot, crop },
            videoUrl,
            "altText": ${loc('altText')},
            "title": ${loc('title')},
            "caption": ${loc('caption')},
          }
        }
      }
    }
  }
`

// Fetches the homepage from the new page system (pageType == "home").
export const pageHomeQuery = /* groq */ `
  *[_type == "page" && projectSlug == $projectSlug && pageType == "home"][0] {
    _id,
    pageType,
    "title": ${loc('title')},
    slug,
    backgroundPattern,
    ${PAGE_SECTIONS_PROJECTION}
  }
`

export const pageBySlugQuery = /* groq */ `
  *[_type == "page" && projectSlug == $projectSlug && slug[$locale].current == $slug][0] {
    _id,
    pageType,
    "title": ${loc('title')},
    "slugMap": slug,
    "redirectFrom": redirectFrom,
    backgroundPattern,
    ${PAGE_SECTIONS_PROJECTION}
  }
`

// Used for 301 redirects: find the page that has $slug in its redirectFrom[$locale] array.
// Returns just the current slug for the locale so we can redirect to it.
export const pageByOldSlugQuery = /* groq */ `
  *[_type == "page" && projectSlug == $projectSlug && $slug in redirectFrom[$locale]][0] {
    "currentSlug": slug[$locale].current
  }
`

export const siteConfigQuery = websiteSiteConfigQuery

// ─── Live Page ────────────────────────────────────────────────────────────────
// ADR-016 Phase A: projects the additive sections[] field via the shared
// PAGE_SECTIONS_PROJECTION fragment — identical to how page queries project
// it. Absent on documents published before this field existed; GROQ resolves
// a missing array field to null, which the frontend already treats as empty.

// ADR-016 Phase C — heroTitle, heroSubtitle, betaNotice, introText,
// heroImage, cloudflareVideoId, featuredEvents projections retired: zero
// remaining runtime reads (live/page.tsx renders body + metadata entirely
// from sections[]/seoTitle/seoDescription). See migration 002 + 003.
export const livePageQuery = /* groq */ `
  *[_type == "livePage" && projectSlug == $projectSlug][0] {
    _id,
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
    ${PAGE_SECTIONS_PROJECTION}
  }
`

// ─── Events Page ──────────────────────────────────────────────────────────────
// ADR-016 Phase C — introText, heroImage, cloudflareVideoId projections
// retired (no remaining reads). heroTitle/heroSubtitle are KEPT — still
// read as SEO-fallback strings by generateMetadata in events/page.tsx.

export const eventsPageQuery = /* groq */ `
  *[_type == "eventsPage" && projectSlug == $projectSlug][0] {
    _id,
    "heroTitle": ${loc('heroTitle')},
    "heroSubtitle": ${loc('heroSubtitle')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
    ${PAGE_SECTIONS_PROJECTION}
  }
`

// ─── Blog Page ────────────────────────────────────────────────────────────────
// ADR-016 Phase C — eyebrow projection retired (no remaining reads).
// heroTitle/heroSubtitle are KEPT — still read as SEO-fallback strings by
// generateMetadata in blog/page.tsx.

export const blogPageQuery = /* groq */ `
  *[_type == "blogPage" && projectSlug == $projectSlug][0] {
    _id,
    "heroTitle": ${loc('heroTitle')},
    "heroSubtitle": ${loc('heroSubtitle')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
    ${PAGE_SECTIONS_PROJECTION}
  }
`

// ─── Design System ────────────────────────────────────────────────────────────

/**
 * Canonical GROQ field selection for a design system document.
 *
 * This is the SINGLE SOURCE OF TRUTH for which fields are fetched.
 * Used in both designSystemQuery (primary tenant fetch) and
 * fetchDesignSystemById (parent fetch during inheritance resolution).
 *
 * Adding a new design system field? Do it here — both query paths
 * update automatically. Then add the merge logic in design-system-resolver.ts.
 */
export const DS_FIELDS_SELECTION = /* groq */ `{
  _id,
  name,
  role,
  description,
  parentDesignSystem,
  eyebrowAccent,
  eyebrowColor,
  heroEyebrowVariant,

  colors {
    darkTheme {
      background, backgroundAlt, surface,
      primary, secondary, accent,
      textPrimary, textSecondary, textMuted,
      border,
      success, warning, danger
    },
    lightTheme {
      background, backgroundAlt, surface,
      primary, secondary, accent,
      textPrimary, textSecondary, textMuted,
      border,
      success, warning, danger
    }
  },

  typography {
    headingFont { source, libraryFont, googleFont },
    bodyFont { source, libraryFont, googleFont },
    // Typographic scale — consumed by buildCssVars() to emit the fluid
    // --font-size-hN / --font-weight-hN / --line-height-hN / --letter-spacing-hN
    // custom properties the section headings read. A level left empty here is
    // simply not emitted, and the component keeps its own legacy size.
    h1 { size, weight, lineHeight, letterSpacing },
    h2 { size, weight, lineHeight, letterSpacing },
    h3 { size, weight, lineHeight, letterSpacing },
    h4 { size, weight, lineHeight, letterSpacing },
    bodyLarge { size, weight, lineHeight, letterSpacing },
    body { size, weight, lineHeight, letterSpacing },
    small { size, weight, lineHeight, letterSpacing }
  },

  radius { small, medium, large },
  spacing { xs, s, m, l, xl },

  buttons {
    primary {
      lightTheme { background, text, borderRadius, hover { background, text } },
      darkTheme { background, text, borderRadius, hover { background, text } }
    },
    secondary {
      lightTheme { background, text, borderRadius, hover { background, text } },
      darkTheme { background, text, borderRadius, hover { background, text } }
    }
  },

  cards {
    lightTheme { background, border },
    darkTheme { background, border }
  },

  footer { surface },

  sectionSurfaces {
    lightTheme {
      surface1, surface2, surface3, brandSurface,
      glass { backgroundOklch, backdropBlur, borderColor, borderWidth }
    },
    darkTheme {
      surface1, surface2, surface3, brandSurface,
      glass { backgroundOklch, backdropBlur, borderColor, borderWidth }
    }
  },

  branding {
    logoHeightDesktop,
    logoHeightMobile
  },

  backgroundAssets[] {
    key, name,
    lightImage { asset-> },
    darkImage { asset-> }
  },

  glass { backgroundOklch, backdropBlur, borderColor, borderWidth },

  forms {
    input    { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    textarea { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    select   { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    checkbox { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    radio    { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    typography { labelColor, labelSize, labelWeight, helpTextColor, helpTextSize, errorTextColor, errorTextSize, requiredColor },
    geometry   { inputHeight, paddingX, paddingY, labelGap, fieldGap, borderRadius }
  },

  navigation { menuRadius, menuGap, dropdownRadius, dropdownStyle },

  cardVariants[] {
    key, label,
    lightTheme { background, border },
    darkTheme { background, border }
  },

  shadows { card, dropdown, modal },

  layout {
    maxContentWidth, maxTextWidth,
    sectionPaddingY, sectionPaddingYCompact, sectionPaddingYLarge
  },

  motion {
    durationFast, durationBase, durationSlow, durationSlower,
    easingStandard, easingDecelerate, easingAccelerate, easingEmphasized
  },

  mediaStyles[] { key, label, borderRadius, aspectRatio, objectFit }
}`

// Fetches the design system for a project.
// Primary path:  project.designSystemRef -> design system document
// Fallback path: design system where projectSlug matches (legacy / unmigrated projects)
// Includes parentDesignSystem reference for inheritance resolution.
export const designSystemQuery = /* groq */ `
  coalesce(
    *[_type == "project" && projectSlug == $projectSlug][0].designSystemRef->,
    *[_type == "designSystem" && projectSlug == $projectSlug][0]
  ) ${DS_FIELDS_SELECTION}
`


// ── Project notification recipients (ADR-019) ─────────────────────────────────
// Returns the project's notifications.recipients groups (topic/emails/enabled),
// read at send time by the form-notification consumer. Same $projectSlug pattern
// as projectIntegrationsQuery / enabledModuleIdsQuery.
export const projectNotificationsQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug][0].notifications.recipients[]{
    topic, emails, enabled
  }
`

// ── Internal-email personalization config (ADR-019 Amendment A) ───────────────
// Tenant/project-level identity + copy, read at send time. `intro` is resolved
// at the event locale; `clientName` is the fromName default. Takes $projectSlug,
// $locale, $defaultLocale.
export const projectInternalEmailQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug][0]{
    "internalEmail": notifications.internalEmail{
      fromName,
      subjectTemplate,
      replyToSubmitter,
      "intro": coalesce(intro[$locale], intro[$defaultLocale], intro.en)
    },
    "clientName": clientRef->displayName,
    "logoUrl": *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].logo.asset->url
  }
`
