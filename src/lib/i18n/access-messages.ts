/**
 * Site Access — visitor-facing messages (ADR-040 §9).
 *
 * Website chrome, not tenant content: one dictionary per platform locale,
 * English fallback (same pattern as unavailable-page-messages.ts). The copy is
 * deliberately identical whatever the reason a page is closed (no session,
 * wrong group, module off, misconfigured): it never hints at the page, its
 * groups or its state.
 *
 * B2.3 — the password prompt. Its notices speak only about the VISITOR's own
 * attempt or session ("that password did not work", "your access has ended"),
 * never about the page, which groups exist or which password is whose.
 * `{minutes}` in `tryAgainIn` is replaced by formatAccessMessage().
 */

export interface AccessMessages {
  /** Heading of the members-only placeholder shown instead of a restricted page. */
  restrictedHeading: string
  /** Body text under it. */
  restrictedBody: string
  /** Browser-tab / share title of a restricted page for a visitor without access. */
  restrictedTitle: string
  /** Accessible name of the lock shown next to a restricted link in the menu. */
  lockedLinkLabel: string
  goHome: string
  /** Lead-in above the password field. */
  promptIntro: string
  passwordLabel: string
  showPassword: string
  hidePassword: string
  submit: string
  /** Button text while the password is being checked. */
  submitting: string
  wrongPassword: string
  tooManyAttempts: string
  /** Appended to tooManyAttempts when the wait is known; `{minutes}` is a whole number. */
  tryAgainIn: string
  unavailable: string
  /** The visitor had access in this browser and it no longer opens anything here. */
  sessionEnded: string
  /** Signed in, but this page needs another password. */
  otherGroups: string
  signedOut: string
  /** Signed out in this browser; the server could not confirm the session was ended. */
  signedOutBrowser: string
  /** Label of the strip shown on a members page the visitor may see. */
  membersArea: string
  signOut: string
}

const MESSAGES: Record<string, AccessMessages> = {
  en: {
    restrictedHeading: 'Members only',
    restrictedBody: 'This page is only available to members.',
    restrictedTitle: 'Members only',
    lockedLinkLabel: 'Members only',
    goHome: 'Go to homepage',
    promptIntro: 'Enter the password you received to continue.',
    passwordLabel: 'Password',
    showPassword: 'Show',
    hidePassword: 'Hide',
    submit: 'Continue',
    submitting: 'Checking…',
    wrongPassword: 'That password didn’t work. Please check it and try again.',
    tooManyAttempts: 'Too many attempts. For your security, please wait a moment before trying again.',
    tryAgainIn: 'You can try again in about {minutes} min.',
    unavailable: 'Signing in isn’t available right now. Please try again a little later.',
    sessionEnded: 'Your access has ended. Please enter the password again.',
    otherGroups: 'You’re signed in, but this page needs a different password. Enter it to continue.',
    signedOut: 'You’ve been signed out.',
    signedOutBrowser: 'You’ve been signed out in this browser.',
    membersArea: 'Members area',
    signOut: 'Sign out',
  },
  it: {
    restrictedHeading: 'Riservato ai membri',
    restrictedBody: 'Questa pagina è disponibile solo per i membri.',
    restrictedTitle: 'Riservato ai membri',
    lockedLinkLabel: 'Riservato ai membri',
    goHome: 'Vai alla home page',
    promptIntro: 'Inserisci la password che hai ricevuto per continuare.',
    passwordLabel: 'Password',
    showPassword: 'Mostra',
    hidePassword: 'Nascondi',
    submit: 'Continua',
    submitting: 'Verifica in corso…',
    wrongPassword: 'La password non è corretta. Controllala e riprova.',
    tooManyAttempts: 'Troppi tentativi. Per la tua sicurezza, attendi un momento prima di riprovare.',
    tryAgainIn: 'Potrai riprovare tra circa {minutes} min.',
    unavailable: 'L’accesso non è disponibile in questo momento. Riprova tra poco.',
    sessionEnded: 'Il tuo accesso è scaduto. Inserisci di nuovo la password.',
    otherGroups: 'Hai già effettuato l’accesso, ma questa pagina richiede un’altra password. Inseriscila per continuare.',
    signedOut: 'Sei uscito.',
    signedOutBrowser: 'Sei uscito da questo browser.',
    membersArea: 'Area membri',
    signOut: 'Esci',
  },
  de: {
    restrictedHeading: 'Nur für Mitglieder',
    restrictedBody: 'Diese Seite ist nur für Mitglieder zugänglich.',
    restrictedTitle: 'Nur für Mitglieder',
    lockedLinkLabel: 'Nur für Mitglieder',
    goHome: 'Zur Startseite',
    promptIntro: 'Gib das Passwort ein, das du erhalten hast, um fortzufahren.',
    passwordLabel: 'Passwort',
    showPassword: 'Anzeigen',
    hidePassword: 'Verbergen',
    submit: 'Weiter',
    submitting: 'Wird geprüft …',
    wrongPassword: 'Das Passwort hat nicht funktioniert. Bitte prüfe es und versuche es erneut.',
    tooManyAttempts: 'Zu viele Versuche. Zu deiner Sicherheit warte bitte einen Moment, bevor du es erneut versuchst.',
    tryAgainIn: 'Du kannst es in etwa {minutes} Min. erneut versuchen.',
    unavailable: 'Die Anmeldung ist gerade nicht verfügbar. Bitte versuche es etwas später erneut.',
    sessionEnded: 'Dein Zugang ist abgelaufen. Bitte gib das Passwort erneut ein.',
    otherGroups: 'Du bist angemeldet, aber für diese Seite brauchst du ein anderes Passwort. Gib es ein, um fortzufahren.',
    signedOut: 'Du wurdest abgemeldet.',
    signedOutBrowser: 'Du wurdest in diesem Browser abgemeldet.',
    membersArea: 'Mitgliederbereich',
    signOut: 'Abmelden',
  },
  fr: {
    restrictedHeading: 'Réservé aux membres',
    restrictedBody: 'Cette page est réservée aux membres.',
    restrictedTitle: 'Réservé aux membres',
    lockedLinkLabel: 'Réservé aux membres',
    goHome: 'Aller à l’accueil',
    promptIntro: 'Saisissez le mot de passe que vous avez reçu pour continuer.',
    passwordLabel: 'Mot de passe',
    showPassword: 'Afficher',
    hidePassword: 'Masquer',
    submit: 'Continuer',
    submitting: 'Vérification…',
    wrongPassword: 'Ce mot de passe n’a pas fonctionné. Vérifiez-le et réessayez.',
    tooManyAttempts: 'Trop de tentatives. Pour votre sécurité, patientez un instant avant de réessayer.',
    tryAgainIn: 'Vous pourrez réessayer dans environ {minutes} min.',
    unavailable: 'La connexion n’est pas disponible pour le moment. Réessayez un peu plus tard.',
    sessionEnded: 'Votre accès a expiré. Saisissez à nouveau le mot de passe.',
    otherGroups: 'Vous êtes connecté, mais cette page nécessite un autre mot de passe. Saisissez-le pour continuer.',
    signedOut: 'Vous êtes déconnecté.',
    signedOutBrowser: 'Vous êtes déconnecté dans ce navigateur.',
    membersArea: 'Espace membres',
    signOut: 'Se déconnecter',
  },
  es: {
    restrictedHeading: 'Solo para miembros',
    restrictedBody: 'Esta página solo está disponible para miembros.',
    restrictedTitle: 'Solo para miembros',
    lockedLinkLabel: 'Solo para miembros',
    goHome: 'Ir a la página de inicio',
    promptIntro: 'Introduce la contraseña que has recibido para continuar.',
    passwordLabel: 'Contraseña',
    showPassword: 'Mostrar',
    hidePassword: 'Ocultar',
    submit: 'Continuar',
    submitting: 'Comprobando…',
    wrongPassword: 'Esa contraseña no ha funcionado. Revísala e inténtalo de nuevo.',
    tooManyAttempts: 'Demasiados intentos. Por tu seguridad, espera un momento antes de volver a intentarlo.',
    tryAgainIn: 'Podrás volver a intentarlo en unos {minutes} min.',
    unavailable: 'El acceso no está disponible en este momento. Inténtalo de nuevo un poco más tarde.',
    sessionEnded: 'Tu acceso ha caducado. Vuelve a introducir la contraseña.',
    otherGroups: 'Ya has iniciado sesión, pero esta página necesita otra contraseña. Introdúcela para continuar.',
    signedOut: 'Has cerrado la sesión.',
    signedOutBrowser: 'Has cerrado la sesión en este navegador.',
    membersArea: 'Área de miembros',
    signOut: 'Cerrar sesión',
  },
  pt: {
    restrictedHeading: 'Apenas para membros',
    restrictedBody: 'Esta página está disponível apenas para membros.',
    restrictedTitle: 'Apenas para membros',
    lockedLinkLabel: 'Apenas para membros',
    goHome: 'Ir para a página inicial',
    promptIntro: 'Introduza a palavra-passe que recebeu para continuar.',
    passwordLabel: 'Palavra-passe',
    showPassword: 'Mostrar',
    hidePassword: 'Ocultar',
    submit: 'Continuar',
    submitting: 'A verificar…',
    wrongPassword: 'Essa palavra-passe não funcionou. Verifique-a e tente novamente.',
    tooManyAttempts: 'Demasiadas tentativas. Para sua segurança, aguarde um momento antes de tentar novamente.',
    tryAgainIn: 'Poderá tentar novamente dentro de cerca de {minutes} min.',
    unavailable: 'O acesso não está disponível de momento. Tente novamente um pouco mais tarde.',
    sessionEnded: 'O seu acesso expirou. Introduza novamente a palavra-passe.',
    otherGroups: 'Já tem sessão iniciada, mas esta página precisa de outra palavra-passe. Introduza-a para continuar.',
    signedOut: 'Terminou a sessão.',
    signedOutBrowser: 'Terminou a sessão neste navegador.',
    membersArea: 'Área de membros',
    signOut: 'Terminar sessão',
  },
  nl: {
    restrictedHeading: 'Alleen voor leden',
    restrictedBody: 'Deze pagina is alleen beschikbaar voor leden.',
    restrictedTitle: 'Alleen voor leden',
    lockedLinkLabel: 'Alleen voor leden',
    goHome: 'Naar de homepage',
    promptIntro: 'Voer het wachtwoord in dat je hebt ontvangen om verder te gaan.',
    passwordLabel: 'Wachtwoord',
    showPassword: 'Tonen',
    hidePassword: 'Verbergen',
    submit: 'Doorgaan',
    submitting: 'Bezig met controleren…',
    wrongPassword: 'Dat wachtwoord werkte niet. Controleer het en probeer het opnieuw.',
    tooManyAttempts: 'Te veel pogingen. Wacht voor je veiligheid even voordat je het opnieuw probeert.',
    tryAgainIn: 'Je kunt het over ongeveer {minutes} min. opnieuw proberen.',
    unavailable: 'Inloggen is op dit moment niet beschikbaar. Probeer het iets later opnieuw.',
    sessionEnded: 'Je toegang is verlopen. Voer het wachtwoord opnieuw in.',
    otherGroups: 'Je bent ingelogd, maar voor deze pagina heb je een ander wachtwoord nodig. Voer het in om verder te gaan.',
    signedOut: 'Je bent uitgelogd.',
    signedOutBrowser: 'Je bent uitgelogd in deze browser.',
    membersArea: 'Ledengedeelte',
    signOut: 'Uitloggen',
  },
}

export const ACCESS_MESSAGES_FOR_TEST = MESSAGES

/**
 * Website languages whose Access text has NOT yet been checked by a native
 * speaker (Tom, 2026-10-24: keep them flagged; it/de added at B2.6 — they are
 * Claude's text too). The visitor still sees them;
 * `access-messages-review.test.ts` prints the list on every run (it warns,
 * never fails). Remove a language here once its text has been reviewed.
 */
export const ACCESS_MESSAGES_PENDING_REVIEW: readonly string[] = ['it', 'de', 'fr', 'es', 'pt', 'nl']

export function getAccessMessages(locale: string | null | undefined): AccessMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

/** Fills `{name}` placeholders (only `{minutes}` exists today). */
export function formatAccessMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m))
}
