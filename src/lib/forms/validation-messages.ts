/**
 * Validation Messages — Abluo Form Field Library
 *
 * Centralized, locale-aware validation message system.
 * Provides localized fallback strings for every built-in validation rule so
 * no English text is ever hardcoded inside field components or validators.
 *
 * Usage:
 *   const messages = getValidationMessages(locale)
 *   validateField(config, value, messages)
 *
 * When a ValidationRule carries its own `rule.message`, that always takes
 * precedence over these fallbacks — callers can override per-field.
 *
 * FUTURE: replace the inline dictionaries below with a Sanity fetch or
 * next-intl integration once the broader i18n system matures.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationMessages {
  /** "This field is required" */
  required: string
  /** "Please select at least one option" */
  requiredSelection: string
  /** "Minimum N characters required" */
  minLength: (n: number) => string
  /** "Maximum N characters allowed" */
  maxLength: (n: number) => string
  /** "Minimum value is N" */
  minValue: (n: number) => string
  /** "Maximum value is N" */
  maxValue: (n: number) => string
  /** "Please enter a valid email address" */
  invalidEmail: string
  /** "Please enter a valid URL" */
  invalidUrl: string
  /** "Please enter a valid phone number" */
  invalidPhone: string
  /** "Invalid format" */
  invalidFormat: string
  /** "File "X" exceeds NMB limit" */
  fileTooLarge: (name: string, mb: number) => string
  /** "File "X" is not an accepted file type" */
  invalidFileType: (name: string) => string
}

/** Messages for the FileUploadField drop-zone UI chrome */
export interface FileUploadMessages {
  /** aria-label on the drop-zone button */
  uploadAreaLabel: string
  /** "Click to upload" — highlighted link text */
  clickToUploadLabel: string
  /** "or drag and drop" — secondary hint */
  dragDropLabel: string
  /** "Max NMB" — size constraint hint */
  maxSizeLabel: (mb: number) => string
  /** aria-label on the per-file remove button */
  removeFileLabel: (name: string) => string
}

// ─── Locale dictionaries ──────────────────────────────────────────────────────

const VALIDATION: Record<string, ValidationMessages> = {
  en: {
    required:          'This field is required',
    requiredSelection: 'Please select at least one option',
    minLength:         (n) => `Minimum ${n} characters required`,
    maxLength:         (n) => `Maximum ${n} characters allowed`,
    minValue:          (n) => `Minimum value is ${n}`,
    maxValue:          (n) => `Maximum value is ${n}`,
    invalidEmail:      'Please enter a valid email address',
    invalidUrl:        'Please enter a valid URL',
    invalidPhone:      'Please enter a valid phone number',
    invalidFormat:     'Invalid format',
    fileTooLarge:      (name, mb) => `File "${name}" exceeds ${mb}MB limit`,
    invalidFileType:   (name)     => `File "${name}" is not an accepted file type`,
  },
  it: {
    required:          'Questo campo è obbligatorio',
    requiredSelection: 'Seleziona almeno un\'opzione',
    minLength:         (n) => `Minimo ${n} caratteri richiesti`,
    maxLength:         (n) => `Massimo ${n} caratteri consentiti`,
    minValue:          (n) => `Il valore minimo è ${n}`,
    maxValue:          (n) => `Il valore massimo è ${n}`,
    invalidEmail:      'Inserisci un indirizzo email valido',
    invalidUrl:        'Inserisci un URL valido',
    invalidPhone:      'Inserisci un numero di telefono valido',
    invalidFormat:     'Formato non valido',
    fileTooLarge:      (name, mb) => `Il file "${name}" supera il limite di ${mb}MB`,
    invalidFileType:   (name)     => `Il file "${name}" non è un tipo di file accettato`,
  },
  de: {
    required:          'Dieses Feld ist erforderlich',
    requiredSelection: 'Bitte wähle mindestens eine Option aus',
    minLength:         (n) => `Mindestens ${n} Zeichen erforderlich`,
    maxLength:         (n) => `Maximal ${n} Zeichen erlaubt`,
    minValue:          (n) => `Mindestwert ist ${n}`,
    maxValue:          (n) => `Höchstwert ist ${n}`,
    invalidEmail:      'Bitte gib eine gültige E-Mail-Adresse ein',
    invalidUrl:        'Bitte gib eine gültige URL ein',
    invalidPhone:      'Bitte gib eine gültige Telefonnummer ein',
    invalidFormat:     'Ungültiges Format',
    fileTooLarge:      (name, mb) => `Datei "${name}" überschreitet das Limit von ${mb} MB`,
    invalidFileType:   (name)     => `Datei "${name}" ist kein akzeptierter Dateityp`,
  },
}

const FILE_UPLOAD: Record<string, FileUploadMessages> = {
  en: {
    uploadAreaLabel:    'Upload files',
    clickToUploadLabel: 'Click to upload',
    dragDropLabel:      'or drag and drop',
    maxSizeLabel:       (mb) => `Max ${mb}MB`,
    removeFileLabel:    (name) => `Remove ${name}`,
  },
  it: {
    uploadAreaLabel:    'Carica file',
    clickToUploadLabel: 'Clicca per caricare',
    dragDropLabel:      'o trascina qui',
    maxSizeLabel:       (mb) => `Max ${mb}MB`,
    removeFileLabel:    (name) => `Rimuovi ${name}`,
  },
  de: {
    uploadAreaLabel:    'Dateien hochladen',
    clickToUploadLabel: 'Zum Hochladen klicken',
    dragDropLabel:      'oder hierher ziehen',
    maxSizeLabel:       (mb) => `Max. ${mb} MB`,
    removeFileLabel:    (name) => `${name} entfernen`,
  },
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns localized validation messages for the given locale.
 * Falls back to English for unsupported locales.
 */
export function getValidationMessages(locale: string): ValidationMessages {
  return VALIDATION[locale] ?? VALIDATION.en
}

/**
 * Returns localized file-upload UI messages for the given locale.
 * Falls back to English for unsupported locales.
 */
export function getFileUploadMessages(locale: string): FileUploadMessages {
  return FILE_UPLOAD[locale] ?? FILE_UPLOAD.en
}

/** English defaults — useful as a prop default when no locale is available */
export const defaultValidationMessages: ValidationMessages = VALIDATION.en
export const defaultFileUploadMessages: FileUploadMessages = FILE_UPLOAD.en
