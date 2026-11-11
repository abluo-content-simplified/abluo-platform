/**
 * Settings → Social Profiles (client dashboard, ADR-049 Amendment A) — the
 * page's interface text in the dashboard languages (en, it, de, fr; English
 * fallback). Same pattern as digital-cards-messages.ts; the completeness test
 * (`__tests__/social-profiles-messages.test.ts`) fails on a missing key or a
 * placeholder that differs between languages. Platform names are brand names
 * (social-links.ts), the same in every language.
 */

const en = {
  title: 'Social Profiles',
  intro: 'Your profiles on social networks. They appear in the website footer and on your Digital Cards.',
  save: 'Save',
  saving: 'Saving…',
  reasonNoChanges: 'Nothing new to save.',
  reasonInvalid: 'Fix the addresses marked below first.',
  readOnly: 'You can look at these profiles but not change them.',
  empty: 'No social profiles yet.',
  add: 'Add profile',
  full: 'At most {max} profiles.',
  platform: 'Network',
  address: 'Profile address',
  addressHint: 'The full address of your profile, e.g. https://www.instagram.com/yourname',
  problemEmpty: 'Enter the address of the profile.',
  problemNotHttps: 'Enter a full web address starting with https://',
  problemWrongPlatform: 'This address is not on {platform}.',
  rowActions: 'Actions for {name}',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  done: 'Done',
  undo: 'Undo',
  saved: 'Saved. The website shows the change in a few minutes.',
  dismiss: 'Dismiss',
  errorConflict: 'These profiles were changed elsewhere. Reload the page.',
  errorInvalid: 'One of the addresses could not be saved. Check it and try again.',
  errorFailed: 'Could not save. Try again.',
  reload: 'Reload',
  unpublished: "Website Settings has changes in Studio that are not on your website yet. You see the latest version here; Save puts it on the website.",
  unpublishedReadOnly: "Website Settings has changes in Studio that are not on your website yet. You see the latest version here.",
}

export type SocialProfilesMessages = typeof en

const it: SocialProfilesMessages = {
  title: 'Profili social',
  intro: 'I tuoi profili sui social network. Compaiono nel piè di pagina del sito e sui tuoi biglietti digitali.',
  save: 'Salva',
  saving: 'Salvataggio…',
  reasonNoChanges: 'Niente di nuovo da salvare.',
  reasonInvalid: 'Prima correggi gli indirizzi segnalati qui sotto.',
  readOnly: 'Puoi vedere questi profili ma non modificarli.',
  empty: 'Ancora nessun profilo social.',
  add: 'Aggiungi profilo',
  full: 'Al massimo {max} profili.',
  platform: 'Social network',
  address: 'Indirizzo del profilo',
  addressHint: 'L’indirizzo completo del tuo profilo, ad es. https://www.instagram.com/tuonome',
  problemEmpty: 'Inserisci l’indirizzo del profilo.',
  problemNotHttps: 'Inserisci un indirizzo web completo che inizi con https://',
  problemWrongPlatform: 'Questo indirizzo non è su {platform}.',
  rowActions: 'Azioni per {name}',
  moveUp: 'Sposta su',
  moveDown: 'Sposta giù',
  remove: 'Rimuovi',
  done: 'Fatto',
  undo: 'Annulla',
  saved: 'Salvato. Il sito mostra la modifica entro pochi minuti.',
  dismiss: 'Chiudi',
  errorConflict: 'Questi profili sono stati modificati altrove. Ricarica la pagina.',
  errorInvalid: 'Uno degli indirizzi non è stato salvato. Controllalo e riprova.',
  errorFailed: 'Non è stato possibile salvare. Riprova.',
  reload: 'Ricarica',
  unpublished: "Le impostazioni del sito hanno modifiche in Studio non ancora pubblicate sul sito. Qui vedi la versione più recente; Salva la mette sul sito.",
  unpublishedReadOnly: "Le impostazioni del sito hanno modifiche in Studio non ancora pubblicate sul sito. Qui vedi la versione più recente.",
}

const de: SocialProfilesMessages = {
  title: 'Soziale Profile',
  intro: 'Deine Profile in sozialen Netzwerken. Sie erscheinen in der Fußzeile der Website und auf deinen digitalen Karten.',
  save: 'Speichern',
  saving: 'Wird gespeichert…',
  reasonNoChanges: 'Nichts Neues zu speichern.',
  reasonInvalid: 'Korrigiere zuerst die unten markierten Adressen.',
  readOnly: 'Du kannst diese Profile ansehen, aber nicht ändern.',
  empty: 'Noch keine sozialen Profile.',
  add: 'Profil hinzufügen',
  full: 'Höchstens {max} Profile.',
  platform: 'Netzwerk',
  address: 'Adresse des Profils',
  addressHint: 'Die vollständige Adresse deines Profils, z. B. https://www.instagram.com/deinname',
  problemEmpty: 'Gib die Adresse des Profils ein.',
  problemNotHttps: 'Gib eine vollständige Webadresse ein, die mit https:// beginnt.',
  problemWrongPlatform: 'Diese Adresse ist nicht auf {platform}.',
  rowActions: 'Aktionen für {name}',
  moveUp: 'Nach oben',
  moveDown: 'Nach unten',
  remove: 'Entfernen',
  done: 'Erledigt',
  undo: 'Rückgängig',
  saved: 'Gespeichert. Die Website zeigt die Änderung in wenigen Minuten.',
  dismiss: 'Schließen',
  errorConflict: 'Diese Profile wurden anderswo geändert. Lade die Seite neu.',
  errorInvalid: 'Eine der Adressen konnte nicht gespeichert werden. Prüfe sie und versuche es erneut.',
  errorFailed: 'Speichern nicht möglich. Versuche es erneut.',
  reload: 'Neu laden',
  unpublished: "Die Website-Einstellungen haben Änderungen im Studio, die noch nicht auf der Website sind. Hier siehst du die neueste Fassung; Speichern bringt sie auf die Website.",
  unpublishedReadOnly: "Die Website-Einstellungen haben Änderungen im Studio, die noch nicht auf der Website sind. Hier siehst du die neueste Fassung.",
}

const fr: SocialProfilesMessages = {
  title: 'Profils sociaux',
  intro: 'Vos profils sur les réseaux sociaux. Ils apparaissent dans le pied de page du site et sur vos cartes numériques.',
  save: 'Enregistrer',
  saving: 'Enregistrement…',
  reasonNoChanges: 'Rien de nouveau à enregistrer.',
  reasonInvalid: 'Corrigez d’abord les adresses signalées ci-dessous.',
  readOnly: 'Vous pouvez consulter ces profils mais pas les modifier.',
  empty: 'Aucun profil social pour le moment.',
  add: 'Ajouter un profil',
  full: '{max} profils au maximum.',
  platform: 'Réseau',
  address: 'Adresse du profil',
  addressHint: 'L’adresse complète de votre profil, par ex. https://www.instagram.com/votrenom',
  problemEmpty: 'Saisissez l’adresse du profil.',
  problemNotHttps: 'Saisissez une adresse web complète commençant par https://',
  problemWrongPlatform: 'Cette adresse n’est pas sur {platform}.',
  rowActions: 'Actions pour {name}',
  moveUp: 'Monter',
  moveDown: 'Descendre',
  remove: 'Supprimer',
  done: 'Terminé',
  undo: 'Annuler',
  saved: 'Enregistré. Le site affichera la modification dans quelques minutes.',
  dismiss: 'Fermer',
  errorConflict: 'Ces profils ont été modifiés ailleurs. Rechargez la page.',
  errorInvalid: 'L’une des adresses n’a pas pu être enregistrée. Vérifiez-la et réessayez.',
  errorFailed: 'Enregistrement impossible. Réessayez.',
  reload: 'Recharger',
  unpublished: "Les réglages du site contiennent des modifications dans Studio qui ne sont pas encore en ligne. Vous voyez ici la version la plus récente ; Enregistrer la met en ligne.",
  unpublishedReadOnly: "Les réglages du site contiennent des modifications dans Studio qui ne sont pas encore en ligne. Vous voyez ici la version la plus récente.",
}

const MESSAGES: Record<string, SocialProfilesMessages> = { en, it, de, fr }

export const SOCIAL_PROFILES_MESSAGE_LOCALES = ['en', 'it', 'de', 'fr'] as const

export function getSocialProfilesMessages(locale: string | null | undefined): SocialProfilesMessages {
  const base = typeof locale === 'string' ? locale.toLowerCase().split('-')[0] : ''
  return MESSAGES[base] ?? en
}

export function formatSocialProfilesMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m))
}

/** Exposed for the completeness test. */
export const SOCIAL_PROFILES_MESSAGES_FOR_TEST = MESSAGES
