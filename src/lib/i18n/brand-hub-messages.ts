/**
 * Brand Hub UI messages (ADR-036).
 *
 * Platform chrome for the public brand guidelines pages: page titles, value
 * labels, colour/typography/spacing labels, contrast texts. Not tenant
 * content (the written guide lives in Sanity), so it is a locale dictionary,
 * the same pattern as gallery-messages.ts.
 *
 * Placeholders ({value}, {role}, {n}, {version}, {date}, {theme}) are filled by
 * `formatBrandHubMessage`.
 */

import type { BrandHubPageId, ColourRoleKey, TypeLevelKey, ValueSource } from '@/lib/modules/brand-hub/types'

export type ContrastExtraKey =
  | 'buttonPrimaryText' | 'buttonSecondaryText' | 'buttonPrimaryBackground' | 'buttonSecondaryBackground'

export interface BrandHubMessages {
  /** Navigation label for the hub as a whole ("Brand guidelines"). */
  navLabel: string
  /** Accessible name of the page navigation. */
  pagesNavLabel: string
  pages: Record<BrandHubPageId, { title: string; description: string }>
  /** Value-source labels and their one-line explanations (legend). */
  sources: Record<ValueSource, { label: string; explanation: string }>
  legendTitle: string
  version: string
  lastUpdated: string
  notVersioned: string
  openPage: string

  light: string
  dark: string
  roles: Record<ColourRoleKey | ContrastExtraKey, string>
  rolesTitle: string
  copy: string
  copied: string
  copyLabel: string
  storedValue: string
  hex: string
  rgb: string
  approximate: string
  opacityNote: string
  sameAs: string
  printNote: string

  buttonsTitle: string
  buttonPrimary: string
  buttonSecondary: string
  buttonSample: string
  buttonBackground: string
  buttonText: string
  buttonHover: string
  buttonRadius: string
  pill: string

  contrastTitle: string
  contrastMethod: string
  contrastOn: string
  contrastForeground: string
  contrastSample: string
  contrastRatio: string
  normalText: string
  largeText: string
  pass: string
  fail: string

  fontsTitle: string
  levelsTitle: string
  fontRoles: { heading: string; body: string; accent: string }
  providerLibrary: string
  providerGoogle: string
  family: string
  size: string
  minSize: string
  weight: string
  lineHeight: string
  letterSpacing: string
  specimenSample: string
  levels: Record<TypeLevelKey, string>

  spacingTitle: string
  radiusTitle: string
  shadowsTitle: string
  shadows: { card: string; dropdown: string; modal: string }

  layoutTitle: string
  layoutLabels: {
    maxContentWidth: string
    maxTextWidth: string
    sectionPaddingY: string
    sectionPaddingYCompact: string
    sectionPaddingYLarge: string
  }
  layoutDiagramTitle: string

  motionDurationsTitle: string
  motionEasingsTitle: string
  motionLabels: {
    durationFast: string
    durationBase: string
    durationSlow: string
    durationSlower: string
    easingStandard: string
    easingDecelerate: string
    easingAccelerate: string
    easingEmphasized: string
  }
  motionValue: string

  assetsTitle: string
  assetLabels: {
    logo: string
    logoLight: string
    faviconSvg: string
    faviconPng: string
    openGraphImage: string
    background: string
  }
  download: string
  format: string
  dimensions: string
  fileSize: string
  onLightTile: string
  onDarkTile: string
  transparentTile: string
  nativeSize: string
  enlarged: string
  intendedForLight: string
  intendedForDark: string

  examplesTitle: string
  doLabel: string
  dontLabel: string
}

const en: BrandHubMessages = {
  navLabel: "Brand guidelines",
  pagesNavLabel: "Brand guidelines pages",
  pages: {
    overview: { title: "Overview", description: "Who we are and how to use these guidelines." },
    colour: { title: "Colour", description: "The colour palette in light and dark, buttons and legibility." },
    typography: { title: "Typography", description: "Typefaces and the sizes used for headings and text." },
    shape: { title: "Spacing and shape", description: "Spacing, rounded corners and shadows." },
    layout: { title: "Layout", description: "Content widths and the space around sections." },
    logo: { title: "Logo and files", description: "Logos, icons and images to download." },
    motion: { title: "Motion", description: "Durations and easing curves for movement." },
  },
  sources: {
    designSystem: { label: "Design system", explanation: "Set in the design system of this website." },
    calculated: { label: "Calculated", explanation: "Worked out from a design system value." },
    platformDefault: { label: "Platform default", explanation: "Not set; this is the value the website actually uses." },
    notSet: { label: "Not set", explanation: "Not set, and there is no single value to show." },
  },
  legendTitle: "Where values come from",
  version: "Version {version}",
  lastUpdated: "Last updated {date}",
  notVersioned: "Not yet versioned",
  openPage: "Open",
  light: "Light",
  dark: "Dark",
  roles: {
    background: "Background", backgroundAlt: "Alternate background", surface: "Surface",
    primary: "Primary", secondary: "Secondary", accent: "Accent",
    textPrimary: "Main text", textSecondary: "Secondary text", textMuted: "Muted text",
    border: "Border", success: "Success", warning: "Warning", danger: "Error",
    buttonPrimaryText: "Primary button text", buttonSecondaryText: "Secondary button text",
    buttonPrimaryBackground: "Primary button", buttonSecondaryBackground: "Secondary button",
  },
  rolesTitle: "Colour roles",
  copy: "Copy",
  copied: "Copied",
  copyLabel: "Copy {value}",
  storedValue: "Value",
  hex: "HEX",
  rgb: "RGB",
  approximate: "Approximate: this colour is outside the standard screen range, so the closest displayable colour is shown.",
  opacityNote: "{n} % opacity on {role}",
  sameAs: "Same as {role}",
  printNote: "Screen colours and printed colours never match exactly. CMYK and Pantone values must be checked on a printed proof.",
  buttonsTitle: "Buttons",
  buttonPrimary: "Primary button",
  buttonSecondary: "Secondary button",
  buttonSample: "Button",
  buttonBackground: "Background",
  buttonText: "Text",
  buttonHover: "Background on hover",
  buttonRadius: "Corner radius",
  pill: "Pill",
  contrastTitle: "Contrast",
  contrastMethod: "WCAG 2.x relative luminance. AA needs 4.5:1 for normal text and 3:1 for large text.",
  contrastOn: "On {role}",
  contrastForeground: "Text colour",
  contrastSample: "Sample",
  contrastRatio: "Ratio",
  normalText: "Normal text",
  largeText: "Large text",
  pass: "Pass",
  fail: "Fail",
  fontsTitle: "Typefaces",
  levelsTitle: "Type scale",
  fontRoles: { heading: "Headings", body: "Body text", accent: "Accent" },
  providerLibrary: "Font library",
  providerGoogle: "Google Fonts",
  family: "Typeface",
  size: "Size",
  minSize: "Minimum size",
  weight: "Weight",
  lineHeight: "Line height",
  letterSpacing: "Letter spacing",
  specimenSample: "The quick brown fox jumps over the lazy dog.",
  levels: { h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", bodyLarge: "Large body text", body: "Body text", small: "Small text" },
  spacingTitle: "Spacing scale",
  radiusTitle: "Rounded corners",
  shadowsTitle: "Shadows",
  shadows: { card: "Card", dropdown: "Dropdown", modal: "Dialog" },
  layoutTitle: "Layout values",
  layoutLabels: {
    maxContentWidth: "Maximum content width",
    maxTextWidth: "Maximum text width",
    sectionPaddingY: "Section spacing",
    sectionPaddingYCompact: "Compact section spacing",
    sectionPaddingYLarge: "Large section spacing",
  },
  layoutDiagramTitle: "Widths in proportion",
  motionDurationsTitle: "Durations",
  motionEasingsTitle: "Easing curves",
  motionLabels: {
    durationFast: "Fast", durationBase: "Standard", durationSlow: "Slow", durationSlower: "Slower",
    easingStandard: "Standard", easingDecelerate: "Decelerate", easingAccelerate: "Accelerate", easingEmphasized: "Emphasised",
  },
  motionValue: "Value",
  assetsTitle: "Files",
  assetLabels: {
    logo: "Logo for dark backgrounds", logoLight: "Logo for light backgrounds",
    faviconSvg: "Favicon (SVG)", faviconPng: "Favicon (PNG)",
    openGraphImage: "Social sharing image", background: "Background graphic",
  },
  download: "Download",
  format: "Format",
  dimensions: "Dimensions",
  fileSize: "File size",
  onLightTile: "On light",
  onDarkTile: "On dark",
  transparentTile: "Transparent background",
  nativeSize: "Actual size",
  enlarged: "4x enlarged",
  intendedForLight: "Made for light backgrounds",
  intendedForDark: "Made for dark backgrounds",
  examplesTitle: "Examples",
  doLabel: "Do",
  dontLabel: "Don't",
}

const it: BrandHubMessages = {
  navLabel: "Linee guida del brand",
  pagesNavLabel: "Pagine delle linee guida",
  pages: {
    overview: { title: "Panoramica", description: "Chi siamo e come usare queste linee guida." },
    colour: { title: "Colore", description: "La palette in versione chiara e scura, i pulsanti e la leggibilità." },
    typography: { title: "Tipografia", description: "I caratteri e le dimensioni di titoli e testi." },
    shape: { title: "Spazi e forme", description: "Spaziature, angoli arrotondati e ombre." },
    layout: { title: "Impaginazione", description: "Larghezze dei contenuti e spazio attorno alle sezioni." },
    logo: { title: "Logo e file", description: "Loghi, icone e immagini da scaricare." },
    motion: { title: "Movimento", description: "Durate e curve di easing per il movimento." },
  },
  sources: {
    designSystem: { label: "Design system", explanation: "Impostato nel design system di questo sito." },
    calculated: { label: "Calcolato", explanation: "Ricavato da un valore del design system." },
    platformDefault: { label: "Predefinito della piattaforma", explanation: "Non impostato; è il valore che il sito usa davvero." },
    notSet: { label: "Non impostato", explanation: "Non impostato e senza un valore unico da mostrare." },
  },
  legendTitle: "Da dove arrivano i valori",
  version: "Versione {version}",
  lastUpdated: "Ultimo aggiornamento {date}",
  notVersioned: "Non ancora versionato",
  openPage: "Apri",
  light: "Chiaro",
  dark: "Scuro",
  roles: {
    background: "Sfondo", backgroundAlt: "Sfondo alternativo", surface: "Superficie",
    primary: "Primario", secondary: "Secondario", accent: "Accento",
    textPrimary: "Testo principale", textSecondary: "Testo secondario", textMuted: "Testo attenuato",
    border: "Bordo", success: "Successo", warning: "Avviso", danger: "Errore",
    buttonPrimaryText: "Testo del pulsante primario", buttonSecondaryText: "Testo del pulsante secondario",
    buttonPrimaryBackground: "Pulsante primario", buttonSecondaryBackground: "Pulsante secondario",
  },
  rolesTitle: "Ruoli del colore",
  copy: "Copia",
  copied: "Copiato",
  copyLabel: "Copia {value}",
  storedValue: "Valore",
  hex: "HEX",
  rgb: "RGB",
  approximate: "Approssimato: questo colore è fuori dalla gamma standard degli schermi, quindi viene mostrato il colore visualizzabile più vicino.",
  opacityNote: "Opacità {n} % su {role}",
  sameAs: "Uguale a {role}",
  printNote: "I colori a schermo e quelli stampati non coincidono mai esattamente. I valori CMYK e Pantone vanno verificati su una prova di stampa.",
  buttonsTitle: "Pulsanti",
  buttonPrimary: "Pulsante primario",
  buttonSecondary: "Pulsante secondario",
  buttonSample: "Pulsante",
  buttonBackground: "Sfondo",
  buttonText: "Testo",
  buttonHover: "Sfondo al passaggio del mouse",
  buttonRadius: "Raggio degli angoli",
  pill: "Pillola",
  contrastTitle: "Contrasto",
  contrastMethod: "Luminanza relativa WCAG 2.x. Il livello AA richiede 4,5:1 per il testo normale e 3:1 per il testo grande.",
  contrastOn: "Su {role}",
  contrastForeground: "Colore del testo",
  contrastSample: "Esempio",
  contrastRatio: "Rapporto",
  normalText: "Testo normale",
  largeText: "Testo grande",
  pass: "Superato",
  fail: "Non superato",
  fontsTitle: "Caratteri",
  levelsTitle: "Scala tipografica",
  fontRoles: { heading: "Titoli", body: "Testo", accent: "Accento" },
  providerLibrary: "Libreria di caratteri",
  providerGoogle: "Google Fonts",
  family: "Carattere",
  size: "Dimensione",
  minSize: "Dimensione minima",
  weight: "Peso",
  lineHeight: "Interlinea",
  letterSpacing: "Spaziatura tra le lettere",
  specimenSample: "Ma la volpe, col suo balzo, ha raggiunto il quieto Fido.",
  levels: { h1: "Titolo 1", h2: "Titolo 2", h3: "Titolo 3", h4: "Titolo 4", bodyLarge: "Testo grande", body: "Testo", small: "Testo piccolo" },
  spacingTitle: "Scala delle spaziature",
  radiusTitle: "Angoli arrotondati",
  shadowsTitle: "Ombre",
  shadows: { card: "Scheda", dropdown: "Menu a tendina", modal: "Finestra di dialogo" },
  layoutTitle: "Valori di impaginazione",
  layoutLabels: {
    maxContentWidth: "Larghezza massima del contenuto",
    maxTextWidth: "Larghezza massima del testo",
    sectionPaddingY: "Spazio delle sezioni",
    sectionPaddingYCompact: "Spazio compatto delle sezioni",
    sectionPaddingYLarge: "Spazio ampio delle sezioni",
  },
  layoutDiagramTitle: "Larghezze in proporzione",
  motionDurationsTitle: "Durate",
  motionEasingsTitle: "Curve di easing",
  motionLabels: {
    durationFast: "Veloce", durationBase: "Standard", durationSlow: "Lenta", durationSlower: "Più lenta",
    easingStandard: "Standard", easingDecelerate: "Decelerazione", easingAccelerate: "Accelerazione", easingEmphasized: "Enfatizzata",
  },
  motionValue: "Valore",
  assetsTitle: "File",
  assetLabels: {
    logo: "Logo per sfondi scuri", logoLight: "Logo per sfondi chiari",
    faviconSvg: "Favicon (SVG)", faviconPng: "Favicon (PNG)",
    openGraphImage: "Immagine per la condivisione social", background: "Grafica di sfondo",
  },
  download: "Scarica",
  format: "Formato",
  dimensions: "Dimensioni",
  fileSize: "Peso del file",
  onLightTile: "Su chiaro",
  onDarkTile: "Su scuro",
  transparentTile: "Sfondo trasparente",
  nativeSize: "Dimensione reale",
  enlarged: "Ingrandita 4 volte",
  intendedForLight: "Pensato per sfondi chiari",
  intendedForDark: "Pensato per sfondi scuri",
  examplesTitle: "Esempi",
  doLabel: "Da fare",
  dontLabel: "Da evitare",
}

const de: BrandHubMessages = {
  navLabel: "Markenrichtlinien",
  pagesNavLabel: "Seiten der Markenrichtlinien",
  pages: {
    overview: { title: "Übersicht", description: "Wer wir sind und wie Sie diese Richtlinien nutzen." },
    colour: { title: "Farbe", description: "Die Farbpalette in Hell und Dunkel, Buttons und Lesbarkeit." },
    typography: { title: "Typografie", description: "Schriften und die Größen für Überschriften und Text." },
    shape: { title: "Abstände und Formen", description: "Abstände, abgerundete Ecken und Schatten." },
    layout: { title: "Layout", description: "Inhaltsbreiten und der Raum um die Abschnitte." },
    logo: { title: "Logo und Dateien", description: "Logos, Icons und Bilder zum Herunterladen." },
    motion: { title: "Bewegung", description: "Dauern und Easing-Kurven für Bewegung." },
  },
  sources: {
    designSystem: { label: "Designsystem", explanation: "Im Designsystem dieser Website festgelegt." },
    calculated: { label: "Berechnet", explanation: "Aus einem Wert des Designsystems abgeleitet." },
    platformDefault: { label: "Plattform-Standard", explanation: "Nicht festgelegt; dies ist der Wert, den die Website tatsächlich verwendet." },
    notSet: { label: "Nicht festgelegt", explanation: "Nicht festgelegt, und es gibt keinen einzelnen Wert, der sich anzeigen ließe." },
  },
  legendTitle: "Woher die Werte stammen",
  version: "Version {version}",
  lastUpdated: "Zuletzt aktualisiert am {date}",
  notVersioned: "Noch nicht versioniert",
  openPage: "Öffnen",
  light: "Hell",
  dark: "Dunkel",
  roles: {
    background: "Hintergrund", backgroundAlt: "Alternativer Hintergrund", surface: "Fläche",
    primary: "Primär", secondary: "Sekundär", accent: "Akzent",
    textPrimary: "Haupttext", textSecondary: "Sekundärer Text", textMuted: "Gedämpfter Text",
    border: "Rahmen", success: "Erfolg", warning: "Warnung", danger: "Fehler",
    buttonPrimaryText: "Text des primären Buttons", buttonSecondaryText: "Text des sekundären Buttons",
    buttonPrimaryBackground: "Primärer Button", buttonSecondaryBackground: "Sekundärer Button",
  },
  rolesTitle: "Farbrollen",
  copy: "Kopieren",
  copied: "Kopiert",
  copyLabel: "{value} kopieren",
  storedValue: "Wert",
  hex: "HEX",
  rgb: "RGB",
  approximate: "Näherungswert: Diese Farbe liegt außerhalb des üblichen Bildschirmfarbraums, daher wird die nächstliegende darstellbare Farbe gezeigt.",
  opacityNote: "{n} % Deckkraft auf {role}",
  sameAs: "Wie {role}",
  printNote: "Bildschirmfarben und Druckfarben stimmen nie exakt überein. CMYK- und Pantone-Werte müssen an einem Andruck geprüft werden.",
  buttonsTitle: "Buttons",
  buttonPrimary: "Primärer Button",
  buttonSecondary: "Sekundärer Button",
  buttonSample: "Button",
  buttonBackground: "Hintergrund",
  buttonText: "Text",
  buttonHover: "Hintergrund beim Überfahren",
  buttonRadius: "Eckenradius",
  pill: "Pille",
  contrastTitle: "Kontrast",
  contrastMethod: "Relative Luminanz nach WCAG 2.x. AA verlangt 4,5:1 für normalen Text und 3:1 für großen Text.",
  contrastOn: "Auf {role}",
  contrastForeground: "Textfarbe",
  contrastSample: "Beispiel",
  contrastRatio: "Verhältnis",
  normalText: "Normaler Text",
  largeText: "Großer Text",
  pass: "Bestanden",
  fail: "Nicht bestanden",
  fontsTitle: "Schriften",
  levelsTitle: "Schriftgrößen",
  fontRoles: { heading: "Überschriften", body: "Fließtext", accent: "Akzent" },
  providerLibrary: "Schriftbibliothek",
  providerGoogle: "Google Fonts",
  family: "Schrift",
  size: "Größe",
  minSize: "Mindestgröße",
  weight: "Schnitt",
  lineHeight: "Zeilenhöhe",
  letterSpacing: "Buchstabenabstand",
  specimenSample: "Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich.",
  levels: { h1: "Überschrift 1", h2: "Überschrift 2", h3: "Überschrift 3", h4: "Überschrift 4", bodyLarge: "Großer Fließtext", body: "Fließtext", small: "Kleiner Text" },
  spacingTitle: "Abstandsskala",
  radiusTitle: "Abgerundete Ecken",
  shadowsTitle: "Schatten",
  shadows: { card: "Karte", dropdown: "Dropdown", modal: "Dialog" },
  layoutTitle: "Layoutwerte",
  layoutLabels: {
    maxContentWidth: "Maximale Inhaltsbreite",
    maxTextWidth: "Maximale Textbreite",
    sectionPaddingY: "Abschnittsabstand",
    sectionPaddingYCompact: "Kompakter Abschnittsabstand",
    sectionPaddingYLarge: "Großer Abschnittsabstand",
  },
  layoutDiagramTitle: "Breiten im Verhältnis",
  motionDurationsTitle: "Dauern",
  motionEasingsTitle: "Easing-Kurven",
  motionLabels: {
    durationFast: "Schnell", durationBase: "Standard", durationSlow: "Langsam", durationSlower: "Langsamer",
    easingStandard: "Standard", easingDecelerate: "Abbremsen", easingAccelerate: "Beschleunigen", easingEmphasized: "Betont",
  },
  motionValue: "Wert",
  assetsTitle: "Dateien",
  assetLabels: {
    logo: "Logo für dunkle Hintergründe", logoLight: "Logo für helle Hintergründe",
    faviconSvg: "Favicon (SVG)", faviconPng: "Favicon (PNG)",
    openGraphImage: "Bild für soziale Netzwerke", background: "Hintergrundgrafik",
  },
  download: "Herunterladen",
  format: "Format",
  dimensions: "Abmessungen",
  fileSize: "Dateigröße",
  onLightTile: "Auf Hell",
  onDarkTile: "Auf Dunkel",
  transparentTile: "Transparenter Hintergrund",
  nativeSize: "Originalgröße",
  enlarged: "4-fach vergrößert",
  intendedForLight: "Für helle Hintergründe gedacht",
  intendedForDark: "Für dunkle Hintergründe gedacht",
  examplesTitle: "Beispiele",
  doLabel: "Empfohlen",
  dontLabel: "Vermeiden",
}

const fr: BrandHubMessages = {
  navLabel: "Charte de marque",
  pagesNavLabel: "Pages de la charte de marque",
  pages: {
    overview: { title: "Aperçu", description: "Qui nous sommes et comment utiliser cette charte." },
    colour: { title: "Couleur", description: "La palette en clair et en sombre, les boutons et la lisibilité." },
    typography: { title: "Typographie", description: "Les polices et les tailles des titres et des textes." },
    shape: { title: "Espaces et formes", description: "Espacements, angles arrondis et ombres." },
    layout: { title: "Mise en page", description: "Largeurs de contenu et espace autour des sections." },
    logo: { title: "Logo et fichiers", description: "Logos, icônes et images à télécharger." },
    motion: { title: "Animation", description: "Durées et courbes d'accélération des mouvements." },
  },
  sources: {
    designSystem: { label: "Design system", explanation: "Défini dans le design system de ce site." },
    calculated: { label: "Calculé", explanation: "Déduit d'une valeur du design system." },
    platformDefault: { label: "Défaut de la plateforme", explanation: "Non défini ; c'est la valeur réellement utilisée par le site." },
    notSet: { label: "Non défini", explanation: "Non défini, et aucune valeur unique ne peut être affichée." },
  },
  legendTitle: "D'où viennent les valeurs",
  version: "Version {version}",
  lastUpdated: "Dernière mise à jour le {date}",
  notVersioned: "Pas encore versionné",
  openPage: "Ouvrir",
  light: "Clair",
  dark: "Sombre",
  roles: {
    background: "Arrière-plan", backgroundAlt: "Arrière-plan alternatif", surface: "Surface",
    primary: "Principale", secondary: "Secondaire", accent: "Accent",
    textPrimary: "Texte principal", textSecondary: "Texte secondaire", textMuted: "Texte atténué",
    border: "Bordure", success: "Succès", warning: "Avertissement", danger: "Erreur",
    buttonPrimaryText: "Texte du bouton principal", buttonSecondaryText: "Texte du bouton secondaire",
    buttonPrimaryBackground: "Bouton principal", buttonSecondaryBackground: "Bouton secondaire",
  },
  rolesTitle: "Rôles des couleurs",
  copy: "Copier",
  copied: "Copié",
  copyLabel: "Copier {value}",
  storedValue: "Valeur",
  hex: "HEX",
  rgb: "RGB",
  approximate: "Approximatif : cette couleur sort de la gamme d'affichage standard ; la couleur affichable la plus proche est montrée.",
  opacityNote: "Opacité de {n} % sur {role}",
  sameAs: "Identique à {role}",
  printNote: "Les couleurs à l'écran et à l'impression ne correspondent jamais exactement. Les valeurs CMJN et Pantone doivent être vérifiées sur une épreuve imprimée.",
  buttonsTitle: "Boutons",
  buttonPrimary: "Bouton principal",
  buttonSecondary: "Bouton secondaire",
  buttonSample: "Bouton",
  buttonBackground: "Arrière-plan",
  buttonText: "Texte",
  buttonHover: "Arrière-plan au survol",
  buttonRadius: "Rayon des angles",
  pill: "Pilule",
  contrastTitle: "Contraste",
  contrastMethod: "Luminance relative WCAG 2.x. Le niveau AA exige 4,5:1 pour le texte normal et 3:1 pour le grand texte.",
  contrastOn: "Sur {role}",
  contrastForeground: "Couleur du texte",
  contrastSample: "Exemple",
  contrastRatio: "Rapport",
  normalText: "Texte normal",
  largeText: "Grand texte",
  pass: "Réussi",
  fail: "Échec",
  fontsTitle: "Polices",
  levelsTitle: "Échelle typographique",
  fontRoles: { heading: "Titres", body: "Texte courant", accent: "Accent" },
  providerLibrary: "Bibliothèque de polices",
  providerGoogle: "Google Fonts",
  family: "Police",
  size: "Taille",
  minSize: "Taille minimale",
  weight: "Graisse",
  lineHeight: "Interligne",
  letterSpacing: "Espacement des lettres",
  specimenSample: "Portez ce vieux whisky au juge blond qui fume.",
  levels: { h1: "Titre 1", h2: "Titre 2", h3: "Titre 3", h4: "Titre 4", bodyLarge: "Grand texte courant", body: "Texte courant", small: "Petit texte" },
  spacingTitle: "Échelle d'espacement",
  radiusTitle: "Angles arrondis",
  shadowsTitle: "Ombres",
  shadows: { card: "Carte", dropdown: "Menu déroulant", modal: "Boîte de dialogue" },
  layoutTitle: "Valeurs de mise en page",
  layoutLabels: {
    maxContentWidth: "Largeur maximale du contenu",
    maxTextWidth: "Largeur maximale du texte",
    sectionPaddingY: "Espacement des sections",
    sectionPaddingYCompact: "Espacement compact des sections",
    sectionPaddingYLarge: "Grand espacement des sections",
  },
  layoutDiagramTitle: "Largeurs en proportion",
  motionDurationsTitle: "Durées",
  motionEasingsTitle: "Courbes d'accélération",
  motionLabels: {
    durationFast: "Rapide", durationBase: "Standard", durationSlow: "Lente", durationSlower: "Plus lente",
    easingStandard: "Standard", easingDecelerate: "Décélération", easingAccelerate: "Accélération", easingEmphasized: "Accentuée",
  },
  motionValue: "Valeur",
  assetsTitle: "Fichiers",
  assetLabels: {
    logo: "Logo pour fonds sombres", logoLight: "Logo pour fonds clairs",
    faviconSvg: "Favicon (SVG)", faviconPng: "Favicon (PNG)",
    openGraphImage: "Image de partage social", background: "Graphisme d'arrière-plan",
  },
  download: "Télécharger",
  format: "Format",
  dimensions: "Dimensions",
  fileSize: "Taille du fichier",
  onLightTile: "Sur clair",
  onDarkTile: "Sur sombre",
  transparentTile: "Fond transparent",
  nativeSize: "Taille réelle",
  enlarged: "Agrandi 4 fois",
  intendedForLight: "Conçu pour les fonds clairs",
  intendedForDark: "Conçu pour les fonds sombres",
  examplesTitle: "Exemples",
  doLabel: "À faire",
  dontLabel: "À éviter",
}

const es: BrandHubMessages = {
  navLabel: "Guía de marca",
  pagesNavLabel: "Páginas de la guía de marca",
  pages: {
    overview: { title: "Resumen", description: "Quiénes somos y cómo usar esta guía." },
    colour: { title: "Color", description: "La paleta en claro y oscuro, los botones y la legibilidad." },
    typography: { title: "Tipografía", description: "Las fuentes y los tamaños de títulos y textos." },
    shape: { title: "Espacios y formas", description: "Espaciados, esquinas redondeadas y sombras." },
    layout: { title: "Maquetación", description: "Anchos de contenido y espacio alrededor de las secciones." },
    logo: { title: "Logotipo y archivos", description: "Logotipos, iconos e imágenes para descargar." },
    motion: { title: "Movimiento", description: "Duraciones y curvas de aceleración del movimiento." },
  },
  sources: {
    designSystem: { label: "Sistema de diseño", explanation: "Definido en el sistema de diseño de este sitio." },
    calculated: { label: "Calculado", explanation: "Obtenido a partir de un valor del sistema de diseño." },
    platformDefault: { label: "Valor de la plataforma", explanation: "No definido; es el valor que el sitio usa realmente." },
    notSet: { label: "Sin definir", explanation: "No definido y sin un valor único que mostrar." },
  },
  legendTitle: "De dónde vienen los valores",
  version: "Versión {version}",
  lastUpdated: "Última actualización: {date}",
  notVersioned: "Aún sin versión",
  openPage: "Abrir",
  light: "Claro",
  dark: "Oscuro",
  roles: {
    background: "Fondo", backgroundAlt: "Fondo alternativo", surface: "Superficie",
    primary: "Primario", secondary: "Secundario", accent: "Acento",
    textPrimary: "Texto principal", textSecondary: "Texto secundario", textMuted: "Texto atenuado",
    border: "Borde", success: "Éxito", warning: "Aviso", danger: "Error",
    buttonPrimaryText: "Texto del botón primario", buttonSecondaryText: "Texto del botón secundario",
    buttonPrimaryBackground: "Botón primario", buttonSecondaryBackground: "Botón secundario",
  },
  rolesTitle: "Funciones del color",
  copy: "Copiar",
  copied: "Copiado",
  copyLabel: "Copiar {value}",
  storedValue: "Valor",
  hex: "HEX",
  rgb: "RGB",
  approximate: "Aproximado: este color queda fuera del rango estándar de pantalla, así que se muestra el color visible más cercano.",
  opacityNote: "{n} % de opacidad sobre {role}",
  sameAs: "Igual que {role}",
  printNote: "Los colores en pantalla y los impresos nunca coinciden exactamente. Los valores CMYK y Pantone deben comprobarse en una prueba impresa.",
  buttonsTitle: "Botones",
  buttonPrimary: "Botón primario",
  buttonSecondary: "Botón secundario",
  buttonSample: "Botón",
  buttonBackground: "Fondo",
  buttonText: "Texto",
  buttonHover: "Fondo al pasar el cursor",
  buttonRadius: "Radio de las esquinas",
  pill: "Píldora",
  contrastTitle: "Contraste",
  contrastMethod: "Luminancia relativa WCAG 2.x. El nivel AA exige 4,5:1 para texto normal y 3:1 para texto grande.",
  contrastOn: "Sobre {role}",
  contrastForeground: "Color del texto",
  contrastSample: "Ejemplo",
  contrastRatio: "Relación",
  normalText: "Texto normal",
  largeText: "Texto grande",
  pass: "Cumple",
  fail: "No cumple",
  fontsTitle: "Fuentes",
  levelsTitle: "Escala tipográfica",
  fontRoles: { heading: "Títulos", body: "Texto", accent: "Acento" },
  providerLibrary: "Biblioteca de fuentes",
  providerGoogle: "Google Fonts",
  family: "Fuente",
  size: "Tamaño",
  minSize: "Tamaño mínimo",
  weight: "Peso",
  lineHeight: "Interlineado",
  letterSpacing: "Espaciado entre letras",
  specimenSample: "El veloz murciélago hindú comía feliz cardillo y kiwi.",
  levels: { h1: "Título 1", h2: "Título 2", h3: "Título 3", h4: "Título 4", bodyLarge: "Texto grande", body: "Texto", small: "Texto pequeño" },
  spacingTitle: "Escala de espaciado",
  radiusTitle: "Esquinas redondeadas",
  shadowsTitle: "Sombras",
  shadows: { card: "Tarjeta", dropdown: "Menú desplegable", modal: "Cuadro de diálogo" },
  layoutTitle: "Valores de maquetación",
  layoutLabels: {
    maxContentWidth: "Ancho máximo del contenido",
    maxTextWidth: "Ancho máximo del texto",
    sectionPaddingY: "Espaciado de las secciones",
    sectionPaddingYCompact: "Espaciado compacto de las secciones",
    sectionPaddingYLarge: "Espaciado amplio de las secciones",
  },
  layoutDiagramTitle: "Anchos en proporción",
  motionDurationsTitle: "Duraciones",
  motionEasingsTitle: "Curvas de aceleración",
  motionLabels: {
    durationFast: "Rápida", durationBase: "Estándar", durationSlow: "Lenta", durationSlower: "Más lenta",
    easingStandard: "Estándar", easingDecelerate: "Desaceleración", easingAccelerate: "Aceleración", easingEmphasized: "Enfatizada",
  },
  motionValue: "Valor",
  assetsTitle: "Archivos",
  assetLabels: {
    logo: "Logotipo para fondos oscuros", logoLight: "Logotipo para fondos claros",
    faviconSvg: "Favicon (SVG)", faviconPng: "Favicon (PNG)",
    openGraphImage: "Imagen para compartir en redes", background: "Gráfico de fondo",
  },
  download: "Descargar",
  format: "Formato",
  dimensions: "Dimensiones",
  fileSize: "Tamaño del archivo",
  onLightTile: "Sobre claro",
  onDarkTile: "Sobre oscuro",
  transparentTile: "Fondo transparente",
  nativeSize: "Tamaño real",
  enlarged: "Ampliado 4 veces",
  intendedForLight: "Pensado para fondos claros",
  intendedForDark: "Pensado para fondos oscuros",
  examplesTitle: "Ejemplos",
  doLabel: "Recomendado",
  dontLabel: "Evitar",
}

const pt: BrandHubMessages = {
  navLabel: "Guia da marca",
  pagesNavLabel: "Páginas do guia da marca",
  pages: {
    overview: { title: "Visão geral", description: "Quem somos e como usar este guia." },
    colour: { title: "Cor", description: "A paleta em claro e escuro, os botões e a legibilidade." },
    typography: { title: "Tipografia", description: "As fontes e os tamanhos de títulos e textos." },
    shape: { title: "Espaços e formas", description: "Espaçamentos, cantos arredondados e sombras." },
    layout: { title: "Layout", description: "Larguras de conteúdo e espaço em redor das secções." },
    logo: { title: "Logótipo e ficheiros", description: "Logótipos, ícones e imagens para transferir." },
    motion: { title: "Movimento", description: "Durações e curvas de aceleração do movimento." },
  },
  sources: {
    designSystem: { label: "Sistema de design", explanation: "Definido no sistema de design deste site." },
    calculated: { label: "Calculado", explanation: "Obtido a partir de um valor do sistema de design." },
    platformDefault: { label: "Predefinição da plataforma", explanation: "Não definido; é o valor que o site realmente usa." },
    notSet: { label: "Não definido", explanation: "Não definido e sem um valor único para mostrar." },
  },
  legendTitle: "De onde vêm os valores",
  version: "Versão {version}",
  lastUpdated: "Última atualização: {date}",
  notVersioned: "Ainda sem versão",
  openPage: "Abrir",
  light: "Claro",
  dark: "Escuro",
  roles: {
    background: "Fundo", backgroundAlt: "Fundo alternativo", surface: "Superfície",
    primary: "Primária", secondary: "Secundária", accent: "Destaque",
    textPrimary: "Texto principal", textSecondary: "Texto secundário", textMuted: "Texto atenuado",
    border: "Contorno", success: "Sucesso", warning: "Aviso", danger: "Erro",
    buttonPrimaryText: "Texto do botão primário", buttonSecondaryText: "Texto do botão secundário",
    buttonPrimaryBackground: "Botão primário", buttonSecondaryBackground: "Botão secundário",
  },
  rolesTitle: "Funções da cor",
  copy: "Copiar",
  copied: "Copiado",
  copyLabel: "Copiar {value}",
  storedValue: "Valor",
  hex: "HEX",
  rgb: "RGB",
  approximate: "Aproximado: esta cor está fora da gama padrão dos ecrãs, por isso é mostrada a cor visível mais próxima.",
  opacityNote: "{n} % de opacidade sobre {role}",
  sameAs: "Igual a {role}",
  printNote: "As cores no ecrã e as impressas nunca coincidem exatamente. Os valores CMYK e Pantone têm de ser verificados numa prova impressa.",
  buttonsTitle: "Botões",
  buttonPrimary: "Botão primário",
  buttonSecondary: "Botão secundário",
  buttonSample: "Botão",
  buttonBackground: "Fundo",
  buttonText: "Texto",
  buttonHover: "Fundo ao passar o cursor",
  buttonRadius: "Raio dos cantos",
  pill: "Pílula",
  contrastTitle: "Contraste",
  contrastMethod: "Luminância relativa WCAG 2.x. O nível AA exige 4,5:1 para texto normal e 3:1 para texto grande.",
  contrastOn: "Sobre {role}",
  contrastForeground: "Cor do texto",
  contrastSample: "Exemplo",
  contrastRatio: "Rácio",
  normalText: "Texto normal",
  largeText: "Texto grande",
  pass: "Cumpre",
  fail: "Não cumpre",
  fontsTitle: "Fontes",
  levelsTitle: "Escala tipográfica",
  fontRoles: { heading: "Títulos", body: "Texto", accent: "Destaque" },
  providerLibrary: "Biblioteca de fontes",
  providerGoogle: "Google Fonts",
  family: "Fonte",
  size: "Tamanho",
  minSize: "Tamanho mínimo",
  weight: "Peso",
  lineHeight: "Entrelinha",
  letterSpacing: "Espaçamento entre letras",
  specimenSample: "Um pequeno jabuti xereta viu dez cegonhas felizes.",
  levels: { h1: "Título 1", h2: "Título 2", h3: "Título 3", h4: "Título 4", bodyLarge: "Texto grande", body: "Texto", small: "Texto pequeno" },
  spacingTitle: "Escala de espaçamento",
  radiusTitle: "Cantos arredondados",
  shadowsTitle: "Sombras",
  shadows: { card: "Cartão", dropdown: "Menu suspenso", modal: "Caixa de diálogo" },
  layoutTitle: "Valores de layout",
  layoutLabels: {
    maxContentWidth: "Largura máxima do conteúdo",
    maxTextWidth: "Largura máxima do texto",
    sectionPaddingY: "Espaçamento das secções",
    sectionPaddingYCompact: "Espaçamento compacto das secções",
    sectionPaddingYLarge: "Espaçamento amplo das secções",
  },
  layoutDiagramTitle: "Larguras em proporção",
  motionDurationsTitle: "Durações",
  motionEasingsTitle: "Curvas de aceleração",
  motionLabels: {
    durationFast: "Rápida", durationBase: "Padrão", durationSlow: "Lenta", durationSlower: "Mais lenta",
    easingStandard: "Padrão", easingDecelerate: "Desaceleração", easingAccelerate: "Aceleração", easingEmphasized: "Enfatizada",
  },
  motionValue: "Valor",
  assetsTitle: "Ficheiros",
  assetLabels: {
    logo: "Logótipo para fundos escuros", logoLight: "Logótipo para fundos claros",
    faviconSvg: "Favicon (SVG)", faviconPng: "Favicon (PNG)",
    openGraphImage: "Imagem para partilha nas redes sociais", background: "Gráfico de fundo",
  },
  download: "Transferir",
  format: "Formato",
  dimensions: "Dimensões",
  fileSize: "Tamanho do ficheiro",
  onLightTile: "Sobre claro",
  onDarkTile: "Sobre escuro",
  transparentTile: "Fundo transparente",
  nativeSize: "Tamanho real",
  enlarged: "Ampliado 4 vezes",
  intendedForLight: "Pensado para fundos claros",
  intendedForDark: "Pensado para fundos escuros",
  examplesTitle: "Exemplos",
  doLabel: "Recomendado",
  dontLabel: "Evitar",
}

const nl: BrandHubMessages = {
  navLabel: "Merkrichtlijnen",
  pagesNavLabel: "Pagina's van de merkrichtlijnen",
  pages: {
    overview: { title: "Overzicht", description: "Wie we zijn en hoe je deze richtlijnen gebruikt." },
    colour: { title: "Kleur", description: "Het kleurenpalet in licht en donker, knoppen en leesbaarheid." },
    typography: { title: "Typografie", description: "Lettertypen en de groottes voor koppen en tekst." },
    shape: { title: "Ruimte en vorm", description: "Witruimte, afgeronde hoeken en schaduwen." },
    layout: { title: "Lay-out", description: "Breedtes van de inhoud en de ruimte rond secties." },
    logo: { title: "Logo en bestanden", description: "Logo's, pictogrammen en afbeeldingen om te downloaden." },
    motion: { title: "Beweging", description: "Duur en versnellingscurves voor beweging." },
  },
  sources: {
    designSystem: { label: "Designsysteem", explanation: "Ingesteld in het designsysteem van deze website." },
    calculated: { label: "Berekend", explanation: "Afgeleid van een waarde uit het designsysteem." },
    platformDefault: { label: "Standaard van het platform", explanation: "Niet ingesteld; dit is de waarde die de website werkelijk gebruikt." },
    notSet: { label: "Niet ingesteld", explanation: "Niet ingesteld, en er is geen enkele waarde om te tonen." },
  },
  legendTitle: "Waar de waarden vandaan komen",
  version: "Versie {version}",
  lastUpdated: "Laatst bijgewerkt op {date}",
  notVersioned: "Nog geen versie",
  openPage: "Openen",
  light: "Licht",
  dark: "Donker",
  roles: {
    background: "Achtergrond", backgroundAlt: "Alternatieve achtergrond", surface: "Vlak",
    primary: "Primair", secondary: "Secundair", accent: "Accent",
    textPrimary: "Hoofdtekst", textSecondary: "Secundaire tekst", textMuted: "Gedempte tekst",
    border: "Rand", success: "Succes", warning: "Waarschuwing", danger: "Fout",
    buttonPrimaryText: "Tekst van de primaire knop", buttonSecondaryText: "Tekst van de secundaire knop",
    buttonPrimaryBackground: "Primaire knop", buttonSecondaryBackground: "Secundaire knop",
  },
  rolesTitle: "Kleurrollen",
  copy: "Kopiëren",
  copied: "Gekopieerd",
  copyLabel: "{value} kopiëren",
  storedValue: "Waarde",
  hex: "HEX",
  rgb: "RGB",
  approximate: "Bij benadering: deze kleur valt buiten het gebruikelijke schermbereik, daarom wordt de dichtstbijzijnde weergeefbare kleur getoond.",
  opacityNote: "{n} % dekking op {role}",
  sameAs: "Zelfde als {role}",
  printNote: "Schermkleuren en gedrukte kleuren komen nooit precies overeen. CMYK- en Pantone-waarden moeten op een drukproef worden gecontroleerd.",
  buttonsTitle: "Knoppen",
  buttonPrimary: "Primaire knop",
  buttonSecondary: "Secundaire knop",
  buttonSample: "Knop",
  buttonBackground: "Achtergrond",
  buttonText: "Tekst",
  buttonHover: "Achtergrond bij aanwijzen",
  buttonRadius: "Hoekradius",
  pill: "Pil",
  contrastTitle: "Contrast",
  contrastMethod: "Relatieve luminantie volgens WCAG 2.x. AA vereist 4,5:1 voor gewone tekst en 3:1 voor grote tekst.",
  contrastOn: "Op {role}",
  contrastForeground: "Tekstkleur",
  contrastSample: "Voorbeeld",
  contrastRatio: "Verhouding",
  normalText: "Gewone tekst",
  largeText: "Grote tekst",
  pass: "Voldoet",
  fail: "Voldoet niet",
  fontsTitle: "Lettertypen",
  levelsTitle: "Lettergroottes",
  fontRoles: { heading: "Koppen", body: "Lopende tekst", accent: "Accent" },
  providerLibrary: "Lettertypebibliotheek",
  providerGoogle: "Google Fonts",
  family: "Lettertype",
  size: "Grootte",
  minSize: "Minimale grootte",
  weight: "Gewicht",
  lineHeight: "Regelhoogte",
  letterSpacing: "Letterspatiëring",
  specimenSample: "Pa's wijze lynx bezag vroom het fikse aquaduct.",
  levels: { h1: "Kop 1", h2: "Kop 2", h3: "Kop 3", h4: "Kop 4", bodyLarge: "Grote lopende tekst", body: "Lopende tekst", small: "Kleine tekst" },
  spacingTitle: "Ruimteschaal",
  radiusTitle: "Afgeronde hoeken",
  shadowsTitle: "Schaduwen",
  shadows: { card: "Kaart", dropdown: "Uitklapmenu", modal: "Dialoogvenster" },
  layoutTitle: "Lay-outwaarden",
  layoutLabels: {
    maxContentWidth: "Maximale breedte van de inhoud",
    maxTextWidth: "Maximale tekstbreedte",
    sectionPaddingY: "Ruimte tussen secties",
    sectionPaddingYCompact: "Compacte ruimte tussen secties",
    sectionPaddingYLarge: "Ruime ruimte tussen secties",
  },
  layoutDiagramTitle: "Breedtes in verhouding",
  motionDurationsTitle: "Duur",
  motionEasingsTitle: "Versnellingscurves",
  motionLabels: {
    durationFast: "Snel", durationBase: "Standaard", durationSlow: "Langzaam", durationSlower: "Langzamer",
    easingStandard: "Standaard", easingDecelerate: "Vertragen", easingAccelerate: "Versnellen", easingEmphasized: "Nadrukkelijk",
  },
  motionValue: "Waarde",
  assetsTitle: "Bestanden",
  assetLabels: {
    logo: "Logo voor donkere achtergronden", logoLight: "Logo voor lichte achtergronden",
    faviconSvg: "Favicon (SVG)", faviconPng: "Favicon (PNG)",
    openGraphImage: "Afbeelding voor delen op social media", background: "Achtergrondafbeelding",
  },
  download: "Downloaden",
  format: "Formaat",
  dimensions: "Afmetingen",
  fileSize: "Bestandsgrootte",
  onLightTile: "Op licht",
  onDarkTile: "Op donker",
  transparentTile: "Transparante achtergrond",
  nativeSize: "Werkelijke grootte",
  enlarged: "4 keer vergroot",
  intendedForLight: "Bedoeld voor lichte achtergronden",
  intendedForDark: "Bedoeld voor donkere achtergronden",
  examplesTitle: "Voorbeelden",
  doLabel: "Doen",
  dontLabel: "Vermijden",
}

const MESSAGES: Record<string, BrandHubMessages> = { en, it, de, fr, es, pt, nl }

export function getBrandHubMessages(locale: string | undefined): BrandHubMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export function formatBrandHubMessage(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole))
}

/** Exposed for the completeness test. */
export const BRAND_HUB_MESSAGES_FOR_TEST = MESSAGES
