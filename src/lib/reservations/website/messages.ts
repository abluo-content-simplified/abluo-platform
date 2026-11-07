// ── Reservations — visitor-facing texts of the two private link pages (ADR-044 D7, D9, D11) ──
//
// The booking page (/<locale>/booking/<token>) and the My pass page
// (/<locale>/my-pass/<token>) are website chrome, not dashboard text: they are
// written per CONTENT locale in this TypeScript dictionary (never in
// messages/*.json, which is the dashboard interface) — the same pattern as the
// Access and Unavailable-page messages.
//
// TRANSLATION STATUS: English is the source. Every other language below was
// machine-written (Claude, 2026-11) and has NOT been proofread by a native
// speaker. Tom: have Italian and German read once; the rest before a client in
// that language relies on them. German addresses the visitor formally ("Sie").
//
// Placeholders: {date} {from} {to} {n}. The pages fill them with plain text
// (React escapes it); no sentence of these pages lives anywhere else.

export type ReservationOutcomeTexts = { none: string; credit: string; refund_review: string }

export type ReservationSiteMessages = {
  goHome: string
  /** Malformed, unknown, other site's, anonymised, module off: ALL look the same (no hint whether it existed). */
  invalid: { heading: string; body: string }
  /** The per-address limit on link lookups was reached. Says nothing about any link. */
  limited: { heading: string; body: string }
  /** Migration 066 missing or the database unreachable. */
  unavailable: { heading: string; body: string }
  booking: {
    title: string
    reference: string
    status: string
    paymentLabel: string
    amount: string
    sessions: string
    noSessions: string
    paymentHeading: string
    bankHeading: string
    payBy: string
    statuses: { pending: string; held: string; awaiting_payment: string; confirmed: string; cancelled: string; expired: string }
    payments: { unpaid: string; partially_paid: string; paid: string; partially_refunded: string; refunded: string }
    sessionCancelled: string
    sessionReleased: string
    sessionPast: string
    passNote: string
    cancel: {
      button: string
      title: string
      body: string
      until: string
      confirm: string
      keep: string
      working: string
      done: ReservationOutcomeTexts
    }
    absence: {
      button: string
      title: string
      confirm: string
      keep: string
      working: string
      done: ReservationOutcomeTexts
    }
  }
  pass: {
    title: string
    valid: string
    entriesLeft: string
    unlimited: string
    statusCancelled: string
    statusExpired: string
    statusNotStarted: string
    upcoming: string
    none: string
    groupLabel: string
    coming: string
    notComing: string
    comeAlong: string
    full: string
    opensOn: string
    closed: string
    noEntries: string
    cancelledSession: string
    saved: string
    entryReturned: string
    entryKept: string
  }
  errors: {
    generic: string
    full: string
    noEntries: string
    deadlinePassed: string
    sessionStarted: string
    alreadyClosed: string
    notAllowed: string
    notOpenYet: string
    closed: string
    unavailable: string
    tooMany: string
    inactive: string
  }
}

const MESSAGES: Record<string, ReservationSiteMessages> = {
  en: {
    goHome: 'Go to homepage',
    invalid: {
      heading: 'This link isn’t valid',
      body: 'The link may be incomplete or no longer active. Please open the link in your latest email again, or get in touch with us.',
    },
    limited: {
      heading: 'Please try again in a little while',
      body: 'We’ve had a lot of attempts from your connection. For everyone’s security, please wait a few minutes and open the link again.',
    },
    unavailable: {
      heading: 'This isn’t available right now',
      body: 'We can’t show this page at the moment. Please try again a little later.',
    },
    booking: {
      title: 'Your booking',
      reference: 'Reference',
      status: 'Status',
      paymentLabel: 'Payment',
      amount: 'Amount',
      sessions: 'Sessions',
      noSessions: 'There are no sessions on this booking.',
      paymentHeading: 'How to pay',
      bankHeading: 'Bank details',
      payBy: 'Please pay by {date} to keep your places.',
      statuses: { pending: 'Being processed', held: 'Places held', awaiting_payment: 'Awaiting payment', confirmed: 'Confirmed', cancelled: 'Cancelled', expired: 'Expired' },
      payments: { unpaid: 'Not paid yet', partially_paid: 'Partly paid', paid: 'Paid', partially_refunded: 'Partly refunded', refunded: 'Refunded' },
      sessionCancelled: 'Cancelled',
      sessionReleased: 'You told us you can’t come',
      sessionPast: 'Past',
      passNote: 'This booking is a pass. Use the My pass link in your email to say which classes you’re coming to.',
      cancel: {
        button: 'Cancel my booking',
        title: 'Cancel this booking?',
        body: 'Your places will be given up. This can’t be undone.',
        until: 'You can cancel online until {date}.',
        confirm: 'Yes, cancel my booking',
        keep: 'Keep my booking',
        working: 'Cancelling…',
        done: {
          none: 'Your booking is cancelled.',
          credit: 'Your booking is cancelled. We’ll be in touch about a credit for what you paid.',
          refund_review: 'Your booking is cancelled. We’ll be in touch about a refund of what you paid.',
        },
      },
      absence: {
        button: 'I can’t come',
        title: 'You can’t come on {date}?',
        confirm: 'Yes, I can’t come',
        keep: 'No, I’ll be there',
        working: 'Saving…',
        done: {
          none: 'Thank you — we’ve noted that you can’t come.',
          credit: 'Thank you — we’ve noted that you can’t come. We’ll be in touch about a credit.',
          refund_review: 'Thank you — we’ve noted that you can’t come. We’ll be in touch about a refund.',
        },
      },
    },
    pass: {
      title: 'My pass',
      valid: 'Valid from {from} to {to}',
      entriesLeft: 'Entries left: {n}',
      unlimited: 'Unlimited entries',
      statusCancelled: 'This pass is no longer active.',
      statusExpired: 'This pass has expired.',
      statusNotStarted: 'This pass starts on {from}.',
      upcoming: 'Upcoming classes',
      none: 'There are no upcoming classes in your pass yet.',
      groupLabel: 'Will you come to this class?',
      coming: 'Coming',
      notComing: 'Not coming',
      comeAlong: 'Just come along — no sign-up needed.',
      full: 'Full',
      opensOn: 'You can answer from {date}.',
      closed: 'Answers are closed for this class.',
      noEntries: 'No entries left.',
      cancelledSession: 'Cancelled',
      saved: 'Saved.',
      entryReturned: 'Saved. Your entry has been given back.',
      entryKept: 'Saved. It was after the deadline, so the entry isn’t given back.',
    },
    errors: {
      generic: 'Something went wrong. Please try again.',
      full: 'Sorry, this class is full.',
      noEntries: 'You have no entries left on this pass.',
      deadlinePassed: 'It’s too late to cancel online. Please get in touch with us.',
      sessionStarted: 'This session has already started.',
      alreadyClosed: 'This booking is already closed.',
      notAllowed: 'This isn’t possible online. Please get in touch with us.',
      notOpenYet: 'You can’t answer for this class yet.',
      closed: 'Answers are closed for this class.',
      unavailable: 'This isn’t available right now. Please try again a little later.',
      tooMany: 'Too many attempts. Please wait a few minutes and try again.',
      inactive: 'This pass is not active for this class.',
    },
  },
  it: {
    goHome: 'Vai alla home page',
    invalid: {
      heading: 'Questo link non è valido',
      body: 'Il link potrebbe essere incompleto o non più attivo. Riapri il link dell’ultima email ricevuta oppure contattaci.',
    },
    limited: {
      heading: 'Riprova tra poco',
      body: 'Dalla tua connessione sono arrivati molti tentativi. Per la sicurezza di tutti, attendi qualche minuto e riapri il link.',
    },
    unavailable: {
      heading: 'Al momento non è disponibile',
      body: 'Non riusciamo a mostrare questa pagina in questo momento. Riprova tra poco.',
    },
    booking: {
      title: 'La tua prenotazione',
      reference: 'Riferimento',
      status: 'Stato',
      paymentLabel: 'Pagamento',
      amount: 'Importo',
      sessions: 'Incontri',
      noSessions: 'Questa prenotazione non ha incontri.',
      paymentHeading: 'Come pagare',
      bankHeading: 'Coordinate bancarie',
      payBy: 'Paga entro il {date} per mantenere i tuoi posti.',
      statuses: { pending: 'In elaborazione', held: 'Posti riservati', awaiting_payment: 'In attesa di pagamento', confirmed: 'Confermata', cancelled: 'Annullata', expired: 'Scaduta' },
      payments: { unpaid: 'Non ancora pagata', partially_paid: 'Pagata in parte', paid: 'Pagata', partially_refunded: 'Rimborsata in parte', refunded: 'Rimborsata' },
      sessionCancelled: 'Annullato',
      sessionReleased: 'Hai comunicato che non puoi venire',
      sessionPast: 'Passato',
      passNote: 'Questa prenotazione è un abbonamento. Usa il link «Il mio abbonamento» nella tua email per indicare a quali lezioni vieni.',
      cancel: {
        button: 'Annulla la mia prenotazione',
        title: 'Annullare questa prenotazione?',
        body: 'I tuoi posti verranno liberati. L’operazione non si può annullare.',
        until: 'Puoi annullare online fino al {date}.',
        confirm: 'Sì, annulla la prenotazione',
        keep: 'Mantieni la prenotazione',
        working: 'Annullamento in corso…',
        done: {
          none: 'La tua prenotazione è stata annullata.',
          credit: 'La tua prenotazione è stata annullata. Ti contatteremo per un credito pari a quanto hai pagato.',
          refund_review: 'La tua prenotazione è stata annullata. Ti contatteremo per il rimborso di quanto hai pagato.',
        },
      },
      absence: {
        button: 'Non posso venire',
        title: 'Non puoi venire il {date}?',
        confirm: 'Sì, non posso venire',
        keep: 'No, ci sarò',
        working: 'Salvataggio…',
        done: {
          none: 'Grazie, abbiamo registrato che non puoi venire.',
          credit: 'Grazie, abbiamo registrato che non puoi venire. Ti contatteremo per un credito.',
          refund_review: 'Grazie, abbiamo registrato che non puoi venire. Ti contatteremo per un rimborso.',
        },
      },
    },
    pass: {
      title: 'Il mio abbonamento',
      valid: 'Valido dal {from} al {to}',
      entriesLeft: 'Ingressi rimasti: {n}',
      unlimited: 'Ingressi illimitati',
      statusCancelled: 'Questo abbonamento non è più attivo.',
      statusExpired: 'Questo abbonamento è scaduto.',
      statusNotStarted: 'Questo abbonamento inizia il {from}.',
      upcoming: 'Prossime lezioni',
      none: 'Non ci sono ancora lezioni in programma nel tuo abbonamento.',
      groupLabel: 'Verrai a questa lezione?',
      coming: 'Vengo',
      notComing: 'Non vengo',
      comeAlong: 'Vieni e basta: non serve iscriversi.',
      full: 'Completo',
      opensOn: 'Puoi rispondere dal {date}.',
      closed: 'Le risposte per questa lezione sono chiuse.',
      noEntries: 'Nessun ingresso rimasto.',
      cancelledSession: 'Annullata',
      saved: 'Salvato.',
      entryReturned: 'Salvato. Il tuo ingresso ti è stato restituito.',
      entryKept: 'Salvato. Era dopo la scadenza, quindi l’ingresso non viene restituito.',
    },
    errors: {
      generic: 'Qualcosa è andato storto. Riprova.',
      full: 'Spiacenti, questa lezione è al completo.',
      noEntries: 'Non hai più ingressi in questo abbonamento.',
      deadlinePassed: 'È troppo tardi per annullare online. Contattaci.',
      sessionStarted: 'Questo incontro è già iniziato.',
      alreadyClosed: 'Questa prenotazione è già chiusa.',
      notAllowed: 'Non è possibile online. Contattaci.',
      notOpenYet: 'Per questa lezione non puoi ancora rispondere.',
      closed: 'Le risposte per questa lezione sono chiuse.',
      unavailable: 'Al momento non è disponibile. Riprova tra poco.',
      tooMany: 'Troppi tentativi. Attendi qualche minuto e riprova.',
      inactive: 'L’abbonamento non è attivo per questa lezione.',
    },
  },
  de: {
    goHome: 'Zur Startseite',
    invalid: {
      heading: 'Dieser Link ist nicht gültig',
      body: 'Der Link ist möglicherweise unvollständig oder nicht mehr aktiv. Bitte öffnen Sie den Link in Ihrer neuesten E-Mail erneut oder nehmen Sie Kontakt mit uns auf.',
    },
    limited: {
      heading: 'Bitte versuchen Sie es in Kürze erneut',
      body: 'Von Ihrer Verbindung gab es sehr viele Versuche. Zur Sicherheit aller warten Sie bitte einige Minuten und öffnen Sie den Link erneut.',
    },
    unavailable: {
      heading: 'Derzeit nicht verfügbar',
      body: 'Wir können diese Seite im Moment nicht anzeigen. Bitte versuchen Sie es etwas später erneut.',
    },
    booking: {
      title: 'Ihre Buchung',
      reference: 'Referenz',
      status: 'Status',
      paymentLabel: 'Zahlung',
      amount: 'Betrag',
      sessions: 'Termine',
      noSessions: 'Diese Buchung enthält keine Termine.',
      paymentHeading: 'So bezahlen Sie',
      bankHeading: 'Bankverbindung',
      payBy: 'Bitte zahlen Sie bis {date}, damit Ihre Plätze reserviert bleiben.',
      statuses: { pending: 'In Bearbeitung', held: 'Plätze reserviert', awaiting_payment: 'Zahlung ausstehend', confirmed: 'Bestätigt', cancelled: 'Storniert', expired: 'Abgelaufen' },
      payments: { unpaid: 'Noch nicht bezahlt', partially_paid: 'Teilweise bezahlt', paid: 'Bezahlt', partially_refunded: 'Teilweise erstattet', refunded: 'Erstattet' },
      sessionCancelled: 'Abgesagt',
      sessionReleased: 'Sie haben mitgeteilt, dass Sie nicht kommen',
      sessionPast: 'Vorbei',
      passNote: 'Diese Buchung ist eine Karte. Über den Link „Meine Karte“ in Ihrer E-Mail teilen Sie mit, an welchen Kursen Sie teilnehmen.',
      cancel: {
        button: 'Meine Buchung stornieren',
        title: 'Diese Buchung stornieren?',
        body: 'Ihre Plätze werden freigegeben. Das lässt sich nicht rückgängig machen.',
        until: 'Sie können online bis {date} stornieren.',
        confirm: 'Ja, Buchung stornieren',
        keep: 'Buchung behalten',
        working: 'Wird storniert …',
        done: {
          none: 'Ihre Buchung wurde storniert.',
          credit: 'Ihre Buchung wurde storniert. Wir melden uns wegen einer Gutschrift für Ihre Zahlung.',
          refund_review: 'Ihre Buchung wurde storniert. Wir melden uns wegen der Erstattung Ihrer Zahlung.',
        },
      },
      absence: {
        button: 'Ich kann nicht kommen',
        title: 'Sie können am {date} nicht kommen?',
        confirm: 'Ja, ich kann nicht kommen',
        keep: 'Nein, ich komme',
        working: 'Wird gespeichert …',
        done: {
          none: 'Vielen Dank – wir haben vermerkt, dass Sie nicht kommen.',
          credit: 'Vielen Dank – wir haben vermerkt, dass Sie nicht kommen. Wir melden uns wegen einer Gutschrift.',
          refund_review: 'Vielen Dank – wir haben vermerkt, dass Sie nicht kommen. Wir melden uns wegen einer Erstattung.',
        },
      },
    },
    pass: {
      title: 'Meine Karte',
      valid: 'Gültig vom {from} bis {to}',
      entriesLeft: 'Verbleibende Eintritte: {n}',
      unlimited: 'Unbegrenzte Eintritte',
      statusCancelled: 'Diese Karte ist nicht mehr aktiv.',
      statusExpired: 'Diese Karte ist abgelaufen.',
      statusNotStarted: 'Diese Karte beginnt am {from}.',
      upcoming: 'Kommende Kurse',
      none: 'Für Ihre Karte gibt es noch keine kommenden Kurse.',
      groupLabel: 'Kommen Sie zu diesem Kurs?',
      coming: 'Ich komme',
      notComing: 'Ich komme nicht',
      comeAlong: 'Kommen Sie einfach vorbei – eine Anmeldung ist nicht nötig.',
      full: 'Ausgebucht',
      opensOn: 'Sie können ab {date} antworten.',
      closed: 'Für diesen Kurs sind Antworten nicht mehr möglich.',
      noEntries: 'Keine Eintritte mehr übrig.',
      cancelledSession: 'Abgesagt',
      saved: 'Gespeichert.',
      entryReturned: 'Gespeichert. Ihr Eintritt wurde Ihnen gutgeschrieben.',
      entryKept: 'Gespeichert. Die Frist war bereits abgelaufen, daher wird der Eintritt nicht gutgeschrieben.',
    },
    errors: {
      generic: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
      full: 'Leider ist dieser Kurs ausgebucht.',
      noEntries: 'Auf dieser Karte sind keine Eintritte mehr übrig.',
      deadlinePassed: 'Eine Online-Stornierung ist nicht mehr möglich. Bitte nehmen Sie Kontakt mit uns auf.',
      sessionStarted: 'Dieser Termin hat bereits begonnen.',
      alreadyClosed: 'Diese Buchung ist bereits abgeschlossen.',
      notAllowed: 'Das ist online nicht möglich. Bitte nehmen Sie Kontakt mit uns auf.',
      notOpenYet: 'Für diesen Kurs können Sie noch nicht antworten.',
      closed: 'Für diesen Kurs sind Antworten nicht mehr möglich.',
      unavailable: 'Derzeit nicht verfügbar. Bitte versuchen Sie es etwas später erneut.',
      tooMany: 'Zu viele Versuche. Bitte warten Sie einige Minuten und versuchen Sie es erneut.',
      inactive: 'Die Karte ist für diesen Kurs nicht aktiv.',
    },
  },
  fr: {
    goHome: 'Aller à l’accueil',
    invalid: {
      heading: 'Ce lien n’est pas valide',
      body: 'Le lien est peut-être incomplet ou n’est plus actif. Veuillez rouvrir le lien de votre dernier e-mail ou nous contacter.',
    },
    limited: {
      heading: 'Veuillez réessayer dans un moment',
      body: 'Votre connexion a effectué de nombreuses tentatives. Pour la sécurité de tous, veuillez patienter quelques minutes puis rouvrir le lien.',
    },
    unavailable: {
      heading: 'Indisponible pour le moment',
      body: 'Nous ne pouvons pas afficher cette page pour le moment. Veuillez réessayer un peu plus tard.',
    },
    booking: {
      title: 'Votre réservation',
      reference: 'Référence',
      status: 'Statut',
      paymentLabel: 'Paiement',
      amount: 'Montant',
      sessions: 'Séances',
      noSessions: 'Cette réservation ne contient aucune séance.',
      paymentHeading: 'Comment payer',
      bankHeading: 'Coordonnées bancaires',
      payBy: 'Veuillez payer avant le {date} pour conserver vos places.',
      statuses: { pending: 'En cours de traitement', held: 'Places réservées', awaiting_payment: 'En attente de paiement', confirmed: 'Confirmée', cancelled: 'Annulée', expired: 'Expirée' },
      payments: { unpaid: 'Pas encore payée', partially_paid: 'Payée en partie', paid: 'Payée', partially_refunded: 'Remboursée en partie', refunded: 'Remboursée' },
      sessionCancelled: 'Annulée',
      sessionReleased: 'Vous avez indiqué que vous ne venez pas',
      sessionPast: 'Passée',
      passNote: 'Cette réservation est un abonnement. Utilisez le lien « Mon abonnement » de votre e-mail pour indiquer à quels cours vous venez.',
      cancel: {
        button: 'Annuler ma réservation',
        title: 'Annuler cette réservation ?',
        body: 'Vos places seront libérées. Cette action est irréversible.',
        until: 'Vous pouvez annuler en ligne jusqu’au {date}.',
        confirm: 'Oui, annuler ma réservation',
        keep: 'Garder ma réservation',
        working: 'Annulation…',
        done: {
          none: 'Votre réservation est annulée.',
          credit: 'Votre réservation est annulée. Nous vous contacterons au sujet d’un avoir pour ce que vous avez payé.',
          refund_review: 'Votre réservation est annulée. Nous vous contacterons au sujet du remboursement de ce que vous avez payé.',
        },
      },
      absence: {
        button: 'Je ne peux pas venir',
        title: 'Vous ne pouvez pas venir le {date} ?',
        confirm: 'Oui, je ne peux pas venir',
        keep: 'Non, je serai là',
        working: 'Enregistrement…',
        done: {
          none: 'Merci, nous avons noté que vous ne pouvez pas venir.',
          credit: 'Merci, nous avons noté que vous ne pouvez pas venir. Nous vous contacterons au sujet d’un avoir.',
          refund_review: 'Merci, nous avons noté que vous ne pouvez pas venir. Nous vous contacterons au sujet d’un remboursement.',
        },
      },
    },
    pass: {
      title: 'Mon abonnement',
      valid: 'Valable du {from} au {to}',
      entriesLeft: 'Entrées restantes : {n}',
      unlimited: 'Entrées illimitées',
      statusCancelled: 'Cet abonnement n’est plus actif.',
      statusExpired: 'Cet abonnement a expiré.',
      statusNotStarted: 'Cet abonnement commence le {from}.',
      upcoming: 'Prochains cours',
      none: 'Il n’y a pas encore de cours à venir dans votre abonnement.',
      groupLabel: 'Viendrez-vous à ce cours ?',
      coming: 'Je viens',
      notComing: 'Je ne viens pas',
      comeAlong: 'Venez simplement : aucune inscription n’est nécessaire.',
      full: 'Complet',
      opensOn: 'Vous pourrez répondre à partir du {date}.',
      closed: 'Les réponses sont closes pour ce cours.',
      noEntries: 'Plus aucune entrée.',
      cancelledSession: 'Annulé',
      saved: 'Enregistré.',
      entryReturned: 'Enregistré. Votre entrée vous a été rendue.',
      entryKept: 'Enregistré. Le délai était dépassé, l’entrée n’est donc pas rendue.',
    },
    errors: {
      generic: 'Un problème est survenu. Veuillez réessayer.',
      full: 'Désolé, ce cours est complet.',
      noEntries: 'Il ne reste plus d’entrées sur cet abonnement.',
      deadlinePassed: 'Il est trop tard pour annuler en ligne. Veuillez nous contacter.',
      sessionStarted: 'Cette séance a déjà commencé.',
      alreadyClosed: 'Cette réservation est déjà clôturée.',
      notAllowed: 'Ce n’est pas possible en ligne. Veuillez nous contacter.',
      notOpenYet: 'Vous ne pouvez pas encore répondre pour ce cours.',
      closed: 'Les réponses sont closes pour ce cours.',
      unavailable: 'Indisponible pour le moment. Veuillez réessayer un peu plus tard.',
      tooMany: 'Trop de tentatives. Veuillez patienter quelques minutes puis réessayer.',
      inactive: 'L’abonnement n’est pas actif pour ce cours.',
    },
  },
  es: {
    goHome: 'Ir a la página de inicio',
    invalid: {
      heading: 'Este enlace no es válido',
      body: 'Puede que el enlace esté incompleto o que ya no esté activo. Abre de nuevo el enlace de tu último correo o ponte en contacto con nosotros.',
    },
    limited: {
      heading: 'Inténtalo de nuevo en un rato',
      body: 'Ha habido muchos intentos desde tu conexión. Por la seguridad de todos, espera unos minutos y vuelve a abrir el enlace.',
    },
    unavailable: {
      heading: 'No disponible en este momento',
      body: 'No podemos mostrar esta página ahora mismo. Inténtalo de nuevo un poco más tarde.',
    },
    booking: {
      title: 'Tu reserva',
      reference: 'Referencia',
      status: 'Estado',
      paymentLabel: 'Pago',
      amount: 'Importe',
      sessions: 'Sesiones',
      noSessions: 'Esta reserva no tiene sesiones.',
      paymentHeading: 'Cómo pagar',
      bankHeading: 'Datos bancarios',
      payBy: 'Paga antes del {date} para conservar tus plazas.',
      statuses: { pending: 'En proceso', held: 'Plazas reservadas', awaiting_payment: 'Pendiente de pago', confirmed: 'Confirmada', cancelled: 'Cancelada', expired: 'Caducada' },
      payments: { unpaid: 'Aún sin pagar', partially_paid: 'Pagada en parte', paid: 'Pagada', partially_refunded: 'Reembolsada en parte', refunded: 'Reembolsada' },
      sessionCancelled: 'Cancelada',
      sessionReleased: 'Nos avisaste de que no puedes venir',
      sessionPast: 'Pasada',
      passNote: 'Esta reserva es un bono. Usa el enlace «Mi bono» de tu correo para indicar a qué clases vienes.',
      cancel: {
        button: 'Cancelar mi reserva',
        title: '¿Cancelar esta reserva?',
        body: 'Tus plazas quedarán libres. Esta acción no se puede deshacer.',
        until: 'Puedes cancelar en línea hasta el {date}.',
        confirm: 'Sí, cancelar mi reserva',
        keep: 'Mantener mi reserva',
        working: 'Cancelando…',
        done: {
          none: 'Tu reserva está cancelada.',
          credit: 'Tu reserva está cancelada. Nos pondremos en contacto contigo sobre un crédito por lo que pagaste.',
          refund_review: 'Tu reserva está cancelada. Nos pondremos en contacto contigo sobre el reembolso de lo que pagaste.',
        },
      },
      absence: {
        button: 'No puedo venir',
        title: '¿No puedes venir el {date}?',
        confirm: 'Sí, no puedo venir',
        keep: 'No, iré',
        working: 'Guardando…',
        done: {
          none: 'Gracias, hemos anotado que no puedes venir.',
          credit: 'Gracias, hemos anotado que no puedes venir. Nos pondremos en contacto contigo sobre un crédito.',
          refund_review: 'Gracias, hemos anotado que no puedes venir. Nos pondremos en contacto contigo sobre un reembolso.',
        },
      },
    },
    pass: {
      title: 'Mi bono',
      valid: 'Válido del {from} al {to}',
      entriesLeft: 'Entradas restantes: {n}',
      unlimited: 'Entradas ilimitadas',
      statusCancelled: 'Este bono ya no está activo.',
      statusExpired: 'Este bono ha caducado.',
      statusNotStarted: 'Este bono empieza el {from}.',
      upcoming: 'Próximas clases',
      none: 'Todavía no hay próximas clases en tu bono.',
      groupLabel: '¿Vendrás a esta clase?',
      coming: 'Vengo',
      notComing: 'No vengo',
      comeAlong: 'Ven sin más: no hace falta apuntarse.',
      full: 'Completa',
      opensOn: 'Podrás responder a partir del {date}.',
      closed: 'Las respuestas para esta clase están cerradas.',
      noEntries: 'No quedan entradas.',
      cancelledSession: 'Cancelada',
      saved: 'Guardado.',
      entryReturned: 'Guardado. Tu entrada se ha devuelto.',
      entryKept: 'Guardado. Era después del plazo, así que la entrada no se devuelve.',
    },
    errors: {
      generic: 'Algo ha salido mal. Inténtalo de nuevo.',
      full: 'Lo sentimos, esta clase está completa.',
      noEntries: 'No te quedan entradas en este bono.',
      deadlinePassed: 'Es demasiado tarde para cancelar en línea. Ponte en contacto con nosotros.',
      sessionStarted: 'Esta sesión ya ha empezado.',
      alreadyClosed: 'Esta reserva ya está cerrada.',
      notAllowed: 'No es posible en línea. Ponte en contacto con nosotros.',
      notOpenYet: 'Todavía no puedes responder para esta clase.',
      closed: 'Las respuestas para esta clase están cerradas.',
      unavailable: 'No disponible en este momento. Inténtalo de nuevo un poco más tarde.',
      tooMany: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
      inactive: 'El bono no está activo para esta clase.',
    },
  },
  pt: {
    goHome: 'Ir para a página inicial',
    invalid: {
      heading: 'Esta ligação não é válida',
      body: 'A ligação pode estar incompleta ou já não estar ativa. Abra novamente a ligação do seu último e-mail ou contacte-nos.',
    },
    limited: {
      heading: 'Tente novamente daqui a pouco',
      body: 'Houve muitas tentativas a partir da sua ligação. Para segurança de todos, aguarde alguns minutos e abra novamente a ligação.',
    },
    unavailable: {
      heading: 'Indisponível neste momento',
      body: 'Não conseguimos mostrar esta página neste momento. Tente novamente um pouco mais tarde.',
    },
    booking: {
      title: 'A sua reserva',
      reference: 'Referência',
      status: 'Estado',
      paymentLabel: 'Pagamento',
      amount: 'Valor',
      sessions: 'Sessões',
      noSessions: 'Esta reserva não tem sessões.',
      paymentHeading: 'Como pagar',
      bankHeading: 'Dados bancários',
      payBy: 'Pague até {date} para manter os seus lugares.',
      statuses: { pending: 'Em processamento', held: 'Lugares reservados', awaiting_payment: 'A aguardar pagamento', confirmed: 'Confirmada', cancelled: 'Cancelada', expired: 'Expirada' },
      payments: { unpaid: 'Ainda não paga', partially_paid: 'Paga em parte', paid: 'Paga', partially_refunded: 'Reembolsada em parte', refunded: 'Reembolsada' },
      sessionCancelled: 'Cancelada',
      sessionReleased: 'Indicou que não pode vir',
      sessionPast: 'Passada',
      passNote: 'Esta reserva é um passe. Use a ligação «O meu passe» do seu e-mail para indicar a que aulas vem.',
      cancel: {
        button: 'Cancelar a minha reserva',
        title: 'Cancelar esta reserva?',
        body: 'Os seus lugares serão libertados. Não é possível desfazer.',
        until: 'Pode cancelar online até {date}.',
        confirm: 'Sim, cancelar a minha reserva',
        keep: 'Manter a minha reserva',
        working: 'A cancelar…',
        done: {
          none: 'A sua reserva foi cancelada.',
          credit: 'A sua reserva foi cancelada. Entraremos em contacto sobre um crédito pelo que pagou.',
          refund_review: 'A sua reserva foi cancelada. Entraremos em contacto sobre o reembolso do que pagou.',
        },
      },
      absence: {
        button: 'Não posso vir',
        title: 'Não pode vir a {date}?',
        confirm: 'Sim, não posso vir',
        keep: 'Não, vou estar presente',
        working: 'A guardar…',
        done: {
          none: 'Obrigado — registámos que não pode vir.',
          credit: 'Obrigado — registámos que não pode vir. Entraremos em contacto sobre um crédito.',
          refund_review: 'Obrigado — registámos que não pode vir. Entraremos em contacto sobre um reembolso.',
        },
      },
    },
    pass: {
      title: 'O meu passe',
      valid: 'Válido de {from} a {to}',
      entriesLeft: 'Entradas restantes: {n}',
      unlimited: 'Entradas ilimitadas',
      statusCancelled: 'Este passe já não está ativo.',
      statusExpired: 'Este passe expirou.',
      statusNotStarted: 'Este passe começa em {from}.',
      upcoming: 'Próximas aulas',
      none: 'Ainda não há próximas aulas no seu passe.',
      groupLabel: 'Vai vir a esta aula?',
      coming: 'Vou',
      notComing: 'Não vou',
      comeAlong: 'Venha simplesmente — não é preciso inscrever-se.',
      full: 'Lotada',
      opensOn: 'Pode responder a partir de {date}.',
      closed: 'As respostas para esta aula estão encerradas.',
      noEntries: 'Não restam entradas.',
      cancelledSession: 'Cancelada',
      saved: 'Guardado.',
      entryReturned: 'Guardado. A sua entrada foi devolvida.',
      entryKept: 'Guardado. Foi depois do prazo, por isso a entrada não é devolvida.',
    },
    errors: {
      generic: 'Algo correu mal. Tente novamente.',
      full: 'Pedimos desculpa, esta aula está lotada.',
      noEntries: 'Já não tem entradas neste passe.',
      deadlinePassed: 'É demasiado tarde para cancelar online. Contacte-nos.',
      sessionStarted: 'Esta sessão já começou.',
      alreadyClosed: 'Esta reserva já está encerrada.',
      notAllowed: 'Não é possível online. Contacte-nos.',
      notOpenYet: 'Ainda não pode responder para esta aula.',
      closed: 'As respostas para esta aula estão encerradas.',
      unavailable: 'Indisponível neste momento. Tente novamente um pouco mais tarde.',
      tooMany: 'Demasiadas tentativas. Aguarde alguns minutos e tente novamente.',
      inactive: 'O passe não está ativo para esta aula.',
    },
  },
  nl: {
    goHome: 'Naar de homepage',
    invalid: {
      heading: 'Deze link is niet geldig',
      body: 'De link is mogelijk onvolledig of niet meer actief. Open de link in je laatste e-mail opnieuw of neem contact met ons op.',
    },
    limited: {
      heading: 'Probeer het over een poosje opnieuw',
      body: 'Vanaf jouw verbinding zijn er veel pogingen gedaan. Wacht voor ieders veiligheid een paar minuten en open de link opnieuw.',
    },
    unavailable: {
      heading: 'Op dit moment niet beschikbaar',
      body: 'We kunnen deze pagina nu niet tonen. Probeer het iets later opnieuw.',
    },
    booking: {
      title: 'Jouw boeking',
      reference: 'Referentie',
      status: 'Status',
      paymentLabel: 'Betaling',
      amount: 'Bedrag',
      sessions: 'Sessies',
      noSessions: 'Deze boeking heeft geen sessies.',
      paymentHeading: 'Zo betaal je',
      bankHeading: 'Bankgegevens',
      payBy: 'Betaal vóór {date} om je plekken te behouden.',
      statuses: { pending: 'In behandeling', held: 'Plekken gereserveerd', awaiting_payment: 'Wacht op betaling', confirmed: 'Bevestigd', cancelled: 'Geannuleerd', expired: 'Verlopen' },
      payments: { unpaid: 'Nog niet betaald', partially_paid: 'Gedeeltelijk betaald', paid: 'Betaald', partially_refunded: 'Gedeeltelijk terugbetaald', refunded: 'Terugbetaald' },
      sessionCancelled: 'Geannuleerd',
      sessionReleased: 'Je hebt laten weten dat je niet komt',
      sessionPast: 'Voorbij',
      passNote: 'Deze boeking is een kaart. Gebruik de link “Mijn kaart” in je e-mail om aan te geven bij welke lessen je erbij bent.',
      cancel: {
        button: 'Mijn boeking annuleren',
        title: 'Deze boeking annuleren?',
        body: 'Je plekken komen vrij. Dit kan niet ongedaan worden gemaakt.',
        until: 'Je kunt online annuleren tot {date}.',
        confirm: 'Ja, mijn boeking annuleren',
        keep: 'Boeking behouden',
        working: 'Bezig met annuleren…',
        done: {
          none: 'Je boeking is geannuleerd.',
          credit: 'Je boeking is geannuleerd. We nemen contact met je op over een tegoed voor wat je hebt betaald.',
          refund_review: 'Je boeking is geannuleerd. We nemen contact met je op over de terugbetaling van wat je hebt betaald.',
        },
      },
      absence: {
        button: 'Ik kan niet komen',
        title: 'Kun je op {date} niet komen?',
        confirm: 'Ja, ik kan niet komen',
        keep: 'Nee, ik kom',
        working: 'Bezig met opslaan…',
        done: {
          none: 'Bedankt, we hebben genoteerd dat je niet komt.',
          credit: 'Bedankt, we hebben genoteerd dat je niet komt. We nemen contact met je op over een tegoed.',
          refund_review: 'Bedankt, we hebben genoteerd dat je niet komt. We nemen contact met je op over een terugbetaling.',
        },
      },
    },
    pass: {
      title: 'Mijn kaart',
      valid: 'Geldig van {from} tot {to}',
      entriesLeft: 'Resterende beurten: {n}',
      unlimited: 'Onbeperkt aantal beurten',
      statusCancelled: 'Deze kaart is niet meer actief.',
      statusExpired: 'Deze kaart is verlopen.',
      statusNotStarted: 'Deze kaart gaat in op {from}.',
      upcoming: 'Komende lessen',
      none: 'Er zijn nog geen komende lessen op je kaart.',
      groupLabel: 'Kom je naar deze les?',
      coming: 'Ik kom',
      notComing: 'Ik kom niet',
      comeAlong: 'Kom gewoon langs: aanmelden is niet nodig.',
      full: 'Vol',
      opensOn: 'Je kunt antwoorden vanaf {date}.',
      closed: 'Reageren is voor deze les gesloten.',
      noEntries: 'Geen beurten meer over.',
      cancelledSession: 'Geannuleerd',
      saved: 'Opgeslagen.',
      entryReturned: 'Opgeslagen. Je beurt is teruggegeven.',
      entryKept: 'Opgeslagen. Het was na de deadline, dus de beurt wordt niet teruggegeven.',
    },
    errors: {
      generic: 'Er is iets misgegaan. Probeer het opnieuw.',
      full: 'Sorry, deze les is vol.',
      noEntries: 'Je hebt geen beurten meer op deze kaart.',
      deadlinePassed: 'Het is te laat om online te annuleren. Neem contact met ons op.',
      sessionStarted: 'Deze sessie is al begonnen.',
      alreadyClosed: 'Deze boeking is al afgesloten.',
      notAllowed: 'Dit kan niet online. Neem contact met ons op.',
      notOpenYet: 'Je kunt voor deze les nog niet reageren.',
      closed: 'Reageren is voor deze les gesloten.',
      unavailable: 'Op dit moment niet beschikbaar. Probeer het iets later opnieuw.',
      tooMany: 'Te veel pogingen. Wacht een paar minuten en probeer het opnieuw.',
      inactive: 'De kaart is niet actief voor deze les.',
    },
  },
}

export const RESERVATION_SITE_MESSAGES_FOR_TEST = MESSAGES

/** The base language of a tag ("pt-BR" → "pt"); English when unknown. */
export function getReservationSiteMessages(locale: string | null | undefined): ReservationSiteMessages {
  const base = typeof locale === 'string' ? locale.trim().toLowerCase().split(/[-_]/)[0] : ''
  return MESSAGES[base] ?? MESSAGES.en
}

/** Fills `{name}` placeholders; an unknown one stays visible (a typo must show in tests, not vanish). */
export function fillSiteMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m))
}
