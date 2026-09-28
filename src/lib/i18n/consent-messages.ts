/**
 * Cookie consent UI messages (ADR-021).
 *
 * Platform chrome for the consent banner, the settings panel, the footer link
 * and the click-to-load embed placeholder. Same dictionary pattern as
 * `video-section-messages.ts`. Vendor names (Google Analytics, Google Maps)
 * are proper nouns and come from the registry, never from here.
 */

export interface ConsentMessages {
  title: string
  body: string
  policyLink: string
  acceptAll: string
  rejectAll: string
  customize: string
  save: string
  close: string
  settingsTitle: string
  necessaryLabel: string
  necessaryDescription: string
  alwaysOn: string
  purposes: Record<'analytics' | 'marketing' | 'functional', { label: string; description: string }>
  footerLink: string
  /** Settings-panel heading for click-to-load embeds (maps, videos). */
  embedsTitle: string
  embedNotice: (vendor: string) => string
  embedLoad: string
  embedAlwaysAllow: (vendor: string) => string
}

const MESSAGES: Record<string, ConsentMessages> = {
  en: {
    title: 'Cookies on this site',
    body: 'We use technical cookies to make the site work. With your permission we also use the cookies below. You can change your choice at any time from “Cookie settings” at the bottom of the page.',
    policyLink: 'Cookie policy',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    customize: 'Customize',
    save: 'Save choices',
    close: 'Close and reject',
    settingsTitle: 'Cookie settings',
    necessaryLabel: 'Necessary',
    necessaryDescription: 'Required for the site to work. They cannot be switched off.',
    alwaysOn: 'Always on',
    purposes: {
      analytics: { label: 'Statistics', description: 'Help us understand how the site is used, in aggregate.' },
      marketing: { label: 'Marketing', description: 'Used to measure and personalise advertising.' },
      functional: { label: 'Functional', description: 'Enable extra features such as chat or embedded services.' },
    },
    footerLink: 'Cookie settings',
    embedsTitle: 'External content',
    embedNotice: (v) => `This content is provided by ${v}, which may set cookies.`,
    embedLoad: 'Load content',
    embedAlwaysAllow: (v) => `Always allow ${v}`,
  },
  it: {
    title: 'Cookie su questo sito',
    body: 'Usiamo cookie tecnici per far funzionare il sito. Con il tuo consenso usiamo anche i cookie indicati qui sotto. Puoi cambiare la tua scelta in qualsiasi momento da “Impostazioni cookie” in fondo alla pagina.',
    policyLink: 'Cookie policy',
    acceptAll: 'Accetta tutti',
    rejectAll: 'Rifiuta tutti',
    customize: 'Personalizza',
    save: 'Salva le scelte',
    close: 'Chiudi e rifiuta',
    settingsTitle: 'Impostazioni cookie',
    necessaryLabel: 'Necessari',
    necessaryDescription: 'Indispensabili per il funzionamento del sito. Non possono essere disattivati.',
    alwaysOn: 'Sempre attivi',
    purposes: {
      analytics: { label: 'Statistiche', description: 'Ci aiutano a capire, in forma aggregata, come viene usato il sito.' },
      marketing: { label: 'Marketing', description: 'Servono a misurare e personalizzare la pubblicità.' },
      functional: { label: 'Funzionali', description: 'Attivano funzioni aggiuntive come chat o servizi incorporati.' },
    },
    footerLink: 'Impostazioni cookie',
    embedsTitle: 'Contenuti esterni',
    embedNotice: (v) => `Questo contenuto è fornito da ${v}, che potrebbe impostare dei cookie.`,
    embedLoad: 'Carica contenuto',
    embedAlwaysAllow: (v) => `Consenti sempre ${v}`,
  },
  de: {
    title: 'Cookies auf dieser Website',
    body: 'Wir verwenden technische Cookies, damit die Website funktioniert. Mit Ihrer Zustimmung verwenden wir auch die unten aufgeführten Cookies. Sie können Ihre Wahl jederzeit über „Cookie-Einstellungen“ unten auf der Seite ändern.',
    policyLink: 'Cookie-Richtlinie',
    acceptAll: 'Alle akzeptieren',
    rejectAll: 'Alle ablehnen',
    customize: 'Anpassen',
    save: 'Auswahl speichern',
    close: 'Schließen und ablehnen',
    settingsTitle: 'Cookie-Einstellungen',
    necessaryLabel: 'Notwendig',
    necessaryDescription: 'Für den Betrieb der Website erforderlich. Sie können nicht deaktiviert werden.',
    alwaysOn: 'Immer aktiv',
    purposes: {
      analytics: { label: 'Statistik', description: 'Helfen uns, die Nutzung der Website in zusammengefasster Form zu verstehen.' },
      marketing: { label: 'Marketing', description: 'Dienen der Messung und Personalisierung von Werbung.' },
      functional: { label: 'Funktional', description: 'Ermöglichen zusätzliche Funktionen wie Chat oder eingebettete Dienste.' },
    },
    footerLink: 'Cookie-Einstellungen',
    embedsTitle: 'Externe Inhalte',
    embedNotice: (v) => `Dieser Inhalt wird von ${v} bereitgestellt, das Cookies setzen kann.`,
    embedLoad: 'Inhalt laden',
    embedAlwaysAllow: (v) => `${v} immer erlauben`,
  },
  fr: {
    title: 'Cookies sur ce site',
    body: 'Nous utilisons des cookies techniques pour faire fonctionner le site. Avec votre accord, nous utilisons aussi les cookies ci-dessous. Vous pouvez modifier votre choix à tout moment via « Paramètres des cookies » en bas de page.',
    policyLink: 'Politique cookies',
    acceptAll: 'Tout accepter',
    rejectAll: 'Tout refuser',
    customize: 'Personnaliser',
    save: 'Enregistrer mes choix',
    close: 'Fermer et refuser',
    settingsTitle: 'Paramètres des cookies',
    necessaryLabel: 'Nécessaires',
    necessaryDescription: 'Indispensables au fonctionnement du site. Ils ne peuvent pas être désactivés.',
    alwaysOn: 'Toujours actifs',
    purposes: {
      analytics: { label: 'Statistiques', description: 'Nous aident à comprendre, de façon agrégée, comment le site est utilisé.' },
      marketing: { label: 'Marketing', description: 'Servent à mesurer et personnaliser la publicité.' },
      functional: { label: 'Fonctionnels', description: 'Activent des fonctions supplémentaires comme le chat ou des services intégrés.' },
    },
    footerLink: 'Paramètres des cookies',
    embedsTitle: 'Contenus externes',
    embedNotice: (v) => `Ce contenu est fourni par ${v}, qui peut déposer des cookies.`,
    embedLoad: 'Charger le contenu',
    embedAlwaysAllow: (v) => `Toujours autoriser ${v}`,
  },
  es: {
    title: 'Cookies en este sitio',
    body: 'Usamos cookies técnicas para que el sitio funcione. Con tu permiso también usamos las cookies indicadas abajo. Puedes cambiar tu elección en cualquier momento desde «Configuración de cookies» al final de la página.',
    policyLink: 'Política de cookies',
    acceptAll: 'Aceptar todas',
    rejectAll: 'Rechazar todas',
    customize: 'Personalizar',
    save: 'Guardar elección',
    close: 'Cerrar y rechazar',
    settingsTitle: 'Configuración de cookies',
    necessaryLabel: 'Necesarias',
    necessaryDescription: 'Imprescindibles para el funcionamiento del sitio. No se pueden desactivar.',
    alwaysOn: 'Siempre activas',
    purposes: {
      analytics: { label: 'Estadísticas', description: 'Nos ayudan a entender, de forma agregada, cómo se usa el sitio.' },
      marketing: { label: 'Marketing', description: 'Sirven para medir y personalizar la publicidad.' },
      functional: { label: 'Funcionales', description: 'Activan funciones adicionales como chat o servicios integrados.' },
    },
    footerLink: 'Configuración de cookies',
    embedsTitle: 'Contenido externo',
    embedNotice: (v) => `Este contenido lo proporciona ${v}, que puede instalar cookies.`,
    embedLoad: 'Cargar contenido',
    embedAlwaysAllow: (v) => `Permitir siempre ${v}`,
  },
  pt: {
    title: 'Cookies neste site',
    body: 'Usamos cookies técnicos para o site funcionar. Com a sua autorização usamos também os cookies abaixo. Pode alterar a sua escolha a qualquer momento em «Definições de cookies» no fundo da página.',
    policyLink: 'Política de cookies',
    acceptAll: 'Aceitar todos',
    rejectAll: 'Rejeitar todos',
    customize: 'Personalizar',
    save: 'Guardar escolhas',
    close: 'Fechar e rejeitar',
    settingsTitle: 'Definições de cookies',
    necessaryLabel: 'Necessários',
    necessaryDescription: 'Indispensáveis ao funcionamento do site. Não podem ser desativados.',
    alwaysOn: 'Sempre ativos',
    purposes: {
      analytics: { label: 'Estatísticas', description: 'Ajudam-nos a perceber, de forma agregada, como o site é usado.' },
      marketing: { label: 'Marketing', description: 'Servem para medir e personalizar a publicidade.' },
      functional: { label: 'Funcionais', description: 'Ativam funções adicionais como chat ou serviços incorporados.' },
    },
    footerLink: 'Definições de cookies',
    embedsTitle: 'Conteúdo externo',
    embedNotice: (v) => `Este conteúdo é fornecido por ${v}, que pode definir cookies.`,
    embedLoad: 'Carregar conteúdo',
    embedAlwaysAllow: (v) => `Permitir sempre ${v}`,
  },
  nl: {
    title: 'Cookies op deze site',
    body: 'We gebruiken technische cookies om de site te laten werken. Met uw toestemming gebruiken we ook de cookies hieronder. U kunt uw keuze altijd wijzigen via ‘Cookie-instellingen’ onderaan de pagina.',
    policyLink: 'Cookiebeleid',
    acceptAll: 'Alles accepteren',
    rejectAll: 'Alles weigeren',
    customize: 'Aanpassen',
    save: 'Keuze opslaan',
    close: 'Sluiten en weigeren',
    settingsTitle: 'Cookie-instellingen',
    necessaryLabel: 'Noodzakelijk',
    necessaryDescription: 'Nodig om de site te laten werken. Ze kunnen niet worden uitgeschakeld.',
    alwaysOn: 'Altijd aan',
    purposes: {
      analytics: { label: 'Statistieken', description: 'Helpen ons te begrijpen hoe de site in het algemeen wordt gebruikt.' },
      marketing: { label: 'Marketing', description: 'Worden gebruikt om advertenties te meten en te personaliseren.' },
      functional: { label: 'Functioneel', description: 'Maken extra functies mogelijk, zoals chat of ingesloten diensten.' },
    },
    footerLink: 'Cookie-instellingen',
    embedsTitle: 'Externe inhoud',
    embedNotice: (v) => `Deze inhoud wordt geleverd door ${v}, dat cookies kan plaatsen.`,
    embedLoad: 'Inhoud laden',
    embedAlwaysAllow: (v) => `${v} altijd toestaan`,
  },
}

export function getConsentMessages(locale: string): ConsentMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
