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
  fr: {
    required:          'Ce champ est obligatoire',
    requiredSelection: 'Veuillez sélectionner au moins une option',
    minLength:         (n) => `Minimum ${n} caractères requis`,
    maxLength:         (n) => `Maximum ${n} caractères autorisés`,
    minValue:          (n) => `La valeur minimale est ${n}`,
    maxValue:          (n) => `La valeur maximale est ${n}`,
    invalidEmail:      'Veuillez saisir une adresse e-mail valide',
    invalidUrl:        'Veuillez saisir une URL valide',
    invalidPhone:      'Veuillez saisir un numéro de téléphone valide',
    invalidFormat:     'Format non valide',
    fileTooLarge:      (name, mb) => `Le fichier "${name}" dépasse la limite de ${mb} Mo`,
    invalidFileType:   (name)     => `Le fichier "${name}" n\'est pas un type de fichier accepté`,
  },
  es: {
    required:          'Este campo es obligatorio',
    requiredSelection: 'Selecciona al menos una opción',
    minLength:         (n) => `Se requieren mínimo ${n} caracteres`,
    maxLength:         (n) => `Se permiten máximo ${n} caracteres`,
    minValue:          (n) => `El valor mínimo es ${n}`,
    maxValue:          (n) => `El valor máximo es ${n}`,
    invalidEmail:      'Introduce una dirección de email válida',
    invalidUrl:        'Introduce una URL válida',
    invalidPhone:      'Introduce un número de teléfono válido',
    invalidFormat:     'Formato no válido',
    fileTooLarge:      (name, mb) => `El archivo "${name}" supera el límite de ${mb} MB`,
    invalidFileType:   (name)     => `El archivo "${name}" no es un tipo de archivo aceptado`,
  },
  pt: {
    required:          'Este campo é obrigatório',
    requiredSelection: 'Selecione pelo menos uma opção',
    minLength:         (n) => `São necessários no mínimo ${n} caracteres`,
    maxLength:         (n) => `São permitidos no máximo ${n} caracteres`,
    minValue:          (n) => `O valor mínimo é ${n}`,
    maxValue:          (n) => `O valor máximo é ${n}`,
    invalidEmail:      'Introduza um endereço de email válido',
    invalidUrl:        'Introduza um URL válido',
    invalidPhone:      'Introduza um número de telefone válido',
    invalidFormat:     'Formato inválido',
    fileTooLarge:      (name, mb) => `O ficheiro "${name}" excede o limite de ${mb} MB`,
    invalidFileType:   (name)     => `O ficheiro "${name}" não é um tipo de ficheiro aceite`,
  },
  nl: {
    required:          'Dit veld is verplicht',
    requiredSelection: 'Selecteer minstens één optie',
    minLength:         (n) => `Minimaal ${n} tekens vereist`,
    maxLength:         (n) => `Maximaal ${n} tekens toegestaan`,
    minValue:          (n) => `De minimumwaarde is ${n}`,
    maxValue:          (n) => `De maximumwaarde is ${n}`,
    invalidEmail:      'Voer een geldig e-mailadres in',
    invalidUrl:        'Voer een geldige URL in',
    invalidPhone:      'Voer een geldig telefoonnummer in',
    invalidFormat:     'Ongeldig formaat',
    fileTooLarge:      (name, mb) => `Bestand "${name}" overschrijdt de limiet van ${mb} MB`,
    invalidFileType:   (name)     => `Bestand "${name}" is geen geaccepteerd bestandstype`,
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
  fr: {
    uploadAreaLabel:    'Téléverser des fichiers',
    clickToUploadLabel: 'Cliquez pour téléverser',
    dragDropLabel:      'ou glissez-déposez',
    maxSizeLabel:       (mb) => `Max ${mb} Mo`,
    removeFileLabel:    (name) => `Supprimer ${name}`,
  },
  es: {
    uploadAreaLabel:    'Subir archivos',
    clickToUploadLabel: 'Haz clic para subir',
    dragDropLabel:      'o arrastra y suelta',
    maxSizeLabel:       (mb) => `Máx. ${mb} MB`,
    removeFileLabel:    (name) => `Eliminar ${name}`,
  },
  pt: {
    uploadAreaLabel:    'Carregar ficheiros',
    clickToUploadLabel: 'Clique para carregar',
    dragDropLabel:      'ou arraste e largue',
    maxSizeLabel:       (mb) => `Máx. ${mb} MB`,
    removeFileLabel:    (name) => `Remover ${name}`,
  },
  nl: {
    uploadAreaLabel:    'Bestanden uploaden',
    clickToUploadLabel: 'Klik om te uploaden',
    dragDropLabel:      'of sleep hierheen',
    maxSizeLabel:       (mb) => `Max. ${mb} MB`,
    removeFileLabel:    (name) => `${name} verwijderen`,
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
