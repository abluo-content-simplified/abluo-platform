import type { TimetableCourseInput } from './timetable'
import { isCourseColor } from './model'

/**
 * The course PREVIEW projection — same public fields the timetable uses
 * (COURSE_PUBLIC_FIELDS), but over ONE document by `_id` (draft or published,
 * perspective "raw"), with none of the website's visibility filters: the
 * editor previews a course before it is on. Scoped by `$projectSlug`.
 */
export const COURSE_PREVIEW_QUERY = /* groq */ `
  *[_type == "course" && _id == $docId && projectSlug == $projectSlug][0] {
    publicId,
    "title": coalesce(title[$locale], title[$defaultLocale], title.en),
    "shortDescription": coalesce(shortDescription[$locale], shortDescription[$defaultLocale], shortDescription.en),
    "color": coalesce(color, "none"),
    "image": select(image->projectSlug == $projectSlug => image->{
    "asset": image.asset,
    "hotspot": image.hotspot,
    "crop": image.crop,
    "alt": coalesce(altText[$locale], altText[$defaultLocale], altText.en, select(!defined(altText._type) => altText))
  })
  }
`

/** The raw projection → the timetable's course input; null when it cannot be shown (no publicId). */
export function previewCourseFrom(raw: Record<string, unknown> | null | undefined): TimetableCourseInput | null {
  if (!raw || typeof raw.publicId !== 'string' || !raw.publicId) return null
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  return {
    publicId: raw.publicId,
    title: str(raw.title),
    color: isCourseColor(raw.color) ? raw.color : 'none',
    shortDescription: str(raw.shortDescription),
    image: raw.image && typeof raw.image === 'object' ? (raw.image as TimetableCourseInput['image']) : null,
  }
}
