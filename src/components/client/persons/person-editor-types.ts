import type { PortableTextBlock } from '@portabletext/editor'
import type { PersonQualificationValue, PersonTranslatableField, PersonTranslations } from '@/lib/api/persons'
import type { ContactRow } from '@/lib/client/person-editor'
import type { LinkTools } from '@/components/client/editor/BodyEditor'
import type { PickerTerm } from '@/components/client/taxonomy/term-picker-model'

/** What the editor shows and saves (the draft's public profile + the contact list of both sides). */
export type PersonValues = {
  firstName: string
  lastName: string
  displayName: string
  honorific: Record<string, string>
  jobTitle: Record<string, string>
  shortBio: Record<string, string>
  /** Machine-translation status beside each translatable value (ADR-023 §4). */
  translations: PersonTranslations
  slug: Record<string, string>
  bio: Record<string, PortableTextBlock[]>
  groups: string[]
  photo: { assetId: string; url: string | null } | null
  languages: string[]
  volunteer: boolean
  website: string
  qualifications: PersonQualificationValue[]
  visibility: 'off' | 'listed' | 'page'
  contacts: ContactRow[]
}

export type PrivateUi = { available: boolean; birthday: string; notes: string; state: 'idle' | 'saving' | 'saved' | 'error' }

/** Everything a tab needs from the editor shell. */
export type EditorApi = {
  projectSlug: string
  /** The site's languages; languages[0] = main. */
  languages: string[]
  d: string
  lang: string
  languageName: (code: string) => string
  /** The person can be changed now (write permission, not archived, not anonymised). */
  editable: boolean
  values: PersonValues
  /** Bumped when the person is reloaded from the server: remounts editors with the new value. */
  generation: number
  /** Shows the change at once and autosaves it (`save` = the draft paths to send). */
  change: (patch: Partial<PersonValues>, save?: Record<string, unknown>) => void
  links?: LinkTools
  groupTerms: PickerTerm[]
  canAddGroup: boolean
  /** May set the photo's focus point (Media permission; saved on the Media Library asset). */
  canSetFocus?: boolean
  priv: PrivateUi
  setBirthday: (value: string) => void
  setNotes: (value: string) => void
  /** Contact rows changed (typed, added, removed): shown at once, each side saved on its own path. */
  changeContacts: (rows: ContactRow[]) => void
  moveContact: (key: string, to: 'public' | 'private') => void
  moving: boolean
  setTab: (tab: EditorTab) => void
  /** The Translate button (ADR-023): absent unless the Translate module is on, the person is editable and the site has 2+ languages. */
  translate?: { running: boolean; run: (fields: PersonTranslatableField[]) => void }
  showToast: (message: string, tone?: 'status' | 'error') => void
}

export const EDITOR_TABS = ['profile', 'about', 'contact', 'website'] as const
export type EditorTab = (typeof EDITOR_TABS)[number]
