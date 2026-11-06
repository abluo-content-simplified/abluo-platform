// ── Courses module — website queries (build spec §3, §5) ──────────────────────
//
// Courses have no page of their own yet, so the website reads them only by
// publicId: the timetable section resolves the course behind each class. Only
// PUBLISHED, non-archived, non-draft courses whose go-live date has passed reach the website. No schedule
// data and no meeting details are read here (those live in Supabase).

/** The public fields of a course, locale-resolved with the usual fallback. */
export const COURSE_PUBLIC_FIELDS = /* groq */ `
  publicId,
  "title": coalesce(title[$locale], title[$defaultLocale], title.en),
  "shortDescription": coalesce(shortDescription[$locale], shortDescription[$defaultLocale], shortDescription.en),
  "color": coalesce(color, "none"),
  // The optional course image: a Media Library asset of THIS website (focal point and alt text live on the asset).
  "image": select(image->projectSlug == $projectSlug => image->{
    "asset": image.asset,
    "hotspot": image.hotspot,
    "crop": image.crop,
    "alt": coalesce(altText[$locale], altText[$defaultLocale], altText.en, select(!defined(altText._type) => altText))
  })
`

/**
 * A course is on the website when it exists as a published document, is not
 * archived and its go-live date (if it has one) has passed. Courses published
 * before dates existed have no publishedAt and stay visible; a "Publish on…"
 * course is a published document with a future publishedAt, so it appears by
 * itself on the date (the website is rendered per request, no cache to flush).
 */
export const COURSE_VISIBLE = /* groq */ `!(_id in path("drafts.**")) && !defined(archivedAt) && (!defined(publishedAt) || publishedAt <= now())`

/** Courses named by publicId (the timetable section's courses). Order is the caller's. */
export const COURSES_BY_PUBLIC_IDS_QUERY = /* groq */ `
  *[_type == "course" && projectSlug == $projectSlug && ${COURSE_VISIBLE} && publicId in $publicIds] { ${COURSE_PUBLIC_FIELDS} }
`

/** Every visible course of the site (a timetable section showing "all courses"), in title order. */
export const COURSES_LISTING_QUERY = /* groq */ `
  *[_type == "course" && projectSlug == $projectSlug && ${COURSE_VISIBLE}] | order(coalesce(title[$locale], title[$defaultLocale], title.en) asc) { ${COURSE_PUBLIC_FIELDS} }
`

/**
 * Saved venues named by a class's place (publicId). Only this website's venues;
 * name localized, address for the printed sheet. Nothing else is projected.
 */
export const TIMETABLE_VENUES_QUERY = /* groq */ `
  *[_type == "eventVenue" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && publicId in $publicIds] {
    publicId,
    "name": coalesce(name[$locale], name[$defaultLocale], name.en),
    address { street, postalCode, city, state, country }
  }
`

/** The page a timetable section sits on: its type and slug in this language (scoped by $projectSlug). Used by the timetable route. */
export const TIMETABLE_PAGE_REF_QUERY = /* groq */ `
  *[_type == "page" && projectSlug == $projectSlug && _id == $pageId && !(_id in path("drafts.**"))][0] { pageType, "slug": slug[$locale].current }
`
