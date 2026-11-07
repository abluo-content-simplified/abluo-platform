// ── Reservations — email texts per language (ADR-044 D10, D16.13) ─────────────
//
// One typed dictionary per CONTENT locale of the platform (src/lib/i18n/locales.ts:
// en, it, de, fr, es, pt, nl). The type makes a missing key a compile error, and
// a test keeps every locale in lockstep with the platform registry.
//
// TRANSLATION STATUS: English is the source. Every other language below was
// machine-written (Claude, 2026-11) and has NOT been proofread by a native
// speaker. Tom: have Italian and German read once; the rest before a client
// in that language relies on them.
//
// Placeholders: {site} {reference} {firstName} {date} {n}. The renderer fills
// them AFTER escaping, so a site name with "<" can never inject markup.
// No sentence of an email lives anywhere else: render.ts only assembles.

export type Copy = { subject: string; heading: string; body: string }

export type Messages = {
  hello: string
  helloAnonymous: string
  reference: string
  sessions: string
  amount: string
  deadline: string
  paymentHeading: string
  bankHeading: string
  manage: string
  manageHint: string
  linkFallback: string
  passHeading: string
  passLink: string
  passLinkNumbered: string
  passHint: string
  outcome: { refund_review: string; credit: string; none: string }
  cancelledSessionHeading: string
  replyHint: string
  footer: string
  testBanner: string
  intents: {
    confirmed: Copy
    confirmedAfterPayment: Copy
    awaitingPayment: Copy
    expired: Copy
    cancelled: Copy
    sessionCancelled: Copy
  }
}

const en: Messages = {
  hello: 'Hi {firstName},',
  helloAnonymous: 'Hello,',
  reference: 'Booking reference',
  sessions: 'Your sessions',
  amount: 'Amount',
  deadline: 'Please complete the payment by {date}, otherwise the places will be released.',
  paymentHeading: 'How to pay',
  bankHeading: 'Bank details',
  manage: 'Manage your booking',
  manageHint: 'This personal link lets you view or cancel your booking. Please do not share it.',
  linkFallback: 'If the button does not work, copy this address into your browser:',
  passHeading: 'Your pass',
  passLink: 'Open My pass',
  passLinkNumbered: 'Open My pass {n}',
  passHint: 'Use this personal link to tell us which sessions you will attend. Please do not share it.',
  outcome: {
    refund_review: 'You have paid for this booking. We will contact you about the refund.',
    credit: 'You have paid for this booking. The value will be credited to you; we will contact you.',
    none: 'Nothing further is needed from you.',
  },
  cancelledSessionHeading: 'The cancelled session',
  replyHint: 'You can reply to this email to reach {site}.',
  footer: 'You receive this email because of a booking at {site}.',
  testBanner: 'TEST DELIVERY. In production this would go to the participant.',
  intents: {
    confirmed: {
      subject: 'Your booking is confirmed ({reference})',
      heading: 'Your booking is confirmed',
      body: 'Thank you! Your booking at {site} is confirmed and your places are reserved.',
    },
    confirmedAfterPayment: {
      subject: 'Payment received, booking confirmed ({reference})',
      heading: 'Payment received',
      body: 'Thank you! We have received your payment and your booking at {site} is now confirmed.',
    },
    awaitingPayment: {
      subject: 'Your places are reserved, payment pending ({reference})',
      heading: 'Your places are reserved',
      body: 'Thank you for booking at {site}. Your places are held for you until the payment arrives.',
    },
    expired: {
      subject: 'Your reservation has expired ({reference})',
      heading: 'Your reservation has expired',
      body: 'We did not receive the payment in time, so the places you held at {site} have been released. You are welcome to book again if places are still available.',
    },
    cancelled: {
      subject: 'Your booking has been cancelled ({reference})',
      heading: 'Your booking has been cancelled',
      body: 'Your booking at {site} has been cancelled. We are sorry to see you go.',
    },
    sessionCancelled: {
      subject: 'A session has been cancelled ({reference})',
      heading: 'A session has been cancelled',
      body: 'We are sorry: a session you were registered for at {site} will not take place.',
    },
  },
}

// Machine-written (not proofread).
const it: Messages = {
  hello: 'Ciao {firstName},',
  helloAnonymous: 'Buongiorno,',
  reference: 'Riferimento della prenotazione',
  sessions: 'I tuoi incontri',
  amount: 'Importo',
  deadline: 'Ti chiediamo di completare il pagamento entro il {date}, altrimenti i posti verranno rilasciati.',
  paymentHeading: 'Come pagare',
  bankHeading: 'Coordinate bancarie',
  manage: 'Gestisci la prenotazione',
  manageHint: 'Con questo link personale puoi vedere o annullare la prenotazione. Ti chiediamo di non condividerlo.',
  linkFallback: 'Se il pulsante non funziona, copia questo indirizzo nel browser:',
  passHeading: 'La tua tessera',
  passLink: 'Apri La mia tessera',
  passLinkNumbered: 'Apri La mia tessera {n}',
  passHint: 'Con questo link personale ci dici a quali incontri parteciperai. Ti chiediamo di non condividerlo.',
  outcome: {
    refund_review: 'Hai pagato questa prenotazione. Ti contatteremo per il rimborso.',
    credit: 'Hai pagato questa prenotazione. L’importo ti verrà accreditato; ti contatteremo.',
    none: 'Non devi fare nient’altro.',
  },
  cancelledSessionHeading: 'L’incontro annullato',
  replyHint: 'Puoi rispondere a questa email per scrivere a {site}.',
  footer: 'Ricevi questa email per una prenotazione presso {site}.',
  testBanner: 'INVIO DI PROVA. In produzione andrebbe al partecipante.',
  intents: {
    confirmed: {
      subject: 'La tua prenotazione è confermata ({reference})',
      heading: 'La tua prenotazione è confermata',
      body: 'Grazie! La tua prenotazione presso {site} è confermata e i posti sono riservati.',
    },
    confirmedAfterPayment: {
      subject: 'Pagamento ricevuto, prenotazione confermata ({reference})',
      heading: 'Pagamento ricevuto',
      body: 'Grazie! Abbiamo ricevuto il pagamento e la tua prenotazione presso {site} è ora confermata.',
    },
    awaitingPayment: {
      subject: 'Posti riservati, in attesa del pagamento ({reference})',
      heading: 'I tuoi posti sono riservati',
      body: 'Grazie per aver prenotato presso {site}. I posti restano riservati per te fino all’arrivo del pagamento.',
    },
    expired: {
      subject: 'La tua riserva è scaduta ({reference})',
      heading: 'La tua riserva è scaduta',
      body: 'Non abbiamo ricevuto il pagamento in tempo, quindi i posti riservati presso {site} sono stati rilasciati. Se ci sono ancora posti, puoi prenotare di nuovo.',
    },
    cancelled: {
      subject: 'La tua prenotazione è stata annullata ({reference})',
      heading: 'La tua prenotazione è stata annullata',
      body: 'La tua prenotazione presso {site} è stata annullata. Ci dispiace.',
    },
    sessionCancelled: {
      subject: 'Un incontro è stato annullato ({reference})',
      heading: 'Un incontro è stato annullato',
      body: 'Ci dispiace: un incontro a cui eri iscritto/a presso {site} non avrà luogo.',
    },
  },
}

// Machine-written (not proofread).
const de: Messages = {
  hello: 'Hallo {firstName},',
  helloAnonymous: 'Guten Tag,',
  reference: 'Buchungsnummer',
  sessions: 'Ihre Termine',
  amount: 'Betrag',
  deadline: 'Bitte schließen Sie die Zahlung bis zum {date} ab, sonst werden die Plätze wieder freigegeben.',
  paymentHeading: 'So zahlen Sie',
  bankHeading: 'Bankverbindung',
  manage: 'Buchung verwalten',
  manageHint: 'Mit diesem persönlichen Link können Sie Ihre Buchung ansehen oder stornieren. Bitte geben Sie ihn nicht weiter.',
  linkFallback: 'Falls die Schaltfläche nicht funktioniert, kopieren Sie diese Adresse in Ihren Browser:',
  passHeading: 'Ihre Karte',
  passLink: 'Meine Karte öffnen',
  passLinkNumbered: 'Meine Karte {n} öffnen',
  passHint: 'Mit diesem persönlichen Link teilen Sie uns mit, an welchen Terminen Sie teilnehmen. Bitte geben Sie ihn nicht weiter.',
  outcome: {
    refund_review: 'Sie haben diese Buchung bezahlt. Wir melden uns wegen der Rückerstattung bei Ihnen.',
    credit: 'Sie haben diese Buchung bezahlt. Der Betrag wird Ihnen gutgeschrieben; wir melden uns bei Ihnen.',
    none: 'Von Ihnen ist nichts weiter nötig.',
  },
  cancelledSessionHeading: 'Der abgesagte Termin',
  replyHint: 'Sie können auf diese E-Mail antworten, um {site} zu erreichen.',
  footer: 'Sie erhalten diese E-Mail wegen einer Buchung bei {site}.',
  testBanner: 'TESTVERSAND. In der Produktion ginge dies an die teilnehmende Person.',
  intents: {
    confirmed: {
      subject: 'Ihre Buchung ist bestätigt ({reference})',
      heading: 'Ihre Buchung ist bestätigt',
      body: 'Vielen Dank! Ihre Buchung bei {site} ist bestätigt und Ihre Plätze sind reserviert.',
    },
    confirmedAfterPayment: {
      subject: 'Zahlung erhalten, Buchung bestätigt ({reference})',
      heading: 'Zahlung erhalten',
      body: 'Vielen Dank! Wir haben Ihre Zahlung erhalten und Ihre Buchung bei {site} ist nun bestätigt.',
    },
    awaitingPayment: {
      subject: 'Ihre Plätze sind reserviert, Zahlung ausstehend ({reference})',
      heading: 'Ihre Plätze sind reserviert',
      body: 'Vielen Dank für Ihre Buchung bei {site}. Ihre Plätze sind bis zum Zahlungseingang für Sie reserviert.',
    },
    expired: {
      subject: 'Ihre Reservierung ist abgelaufen ({reference})',
      heading: 'Ihre Reservierung ist abgelaufen',
      body: 'Wir haben die Zahlung nicht rechtzeitig erhalten, daher wurden Ihre reservierten Plätze bei {site} freigegeben. Sie können gern erneut buchen, sofern noch Plätze frei sind.',
    },
    cancelled: {
      subject: 'Ihre Buchung wurde storniert ({reference})',
      heading: 'Ihre Buchung wurde storniert',
      body: 'Ihre Buchung bei {site} wurde storniert. Das tut uns leid.',
    },
    sessionCancelled: {
      subject: 'Ein Termin wurde abgesagt ({reference})',
      heading: 'Ein Termin wurde abgesagt',
      body: 'Es tut uns leid: Ein Termin, für den Sie bei {site} angemeldet waren, findet nicht statt.',
    },
  },
}

// Machine-written (not proofread).
const fr: Messages = {
  hello: 'Bonjour {firstName},',
  helloAnonymous: 'Bonjour,',
  reference: 'Référence de réservation',
  sessions: 'Vos séances',
  amount: 'Montant',
  deadline: 'Merci de régler le paiement avant le {date}, faute de quoi les places seront libérées.',
  paymentHeading: 'Comment payer',
  bankHeading: 'Coordonnées bancaires',
  manage: 'Gérer votre réservation',
  manageHint: 'Ce lien personnel vous permet de consulter ou d’annuler votre réservation. Merci de ne pas le partager.',
  linkFallback: 'Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :',
  passHeading: 'Votre carte',
  passLink: 'Ouvrir Ma carte',
  passLinkNumbered: 'Ouvrir Ma carte {n}',
  passHint: 'Ce lien personnel vous permet de nous indiquer les séances auxquelles vous participerez. Merci de ne pas le partager.',
  outcome: {
    refund_review: 'Vous avez payé cette réservation. Nous vous contacterons au sujet du remboursement.',
    credit: 'Vous avez payé cette réservation. Le montant vous sera crédité ; nous vous contacterons.',
    none: 'Aucune action n’est nécessaire de votre part.',
  },
  cancelledSessionHeading: 'La séance annulée',
  replyHint: 'Vous pouvez répondre à cet e-mail pour joindre {site}.',
  footer: 'Vous recevez cet e-mail en raison d’une réservation chez {site}.',
  testBanner: 'ENVOI DE TEST. En production, ce message irait au participant.',
  intents: {
    confirmed: {
      subject: 'Votre réservation est confirmée ({reference})',
      heading: 'Votre réservation est confirmée',
      body: 'Merci ! Votre réservation chez {site} est confirmée et vos places sont réservées.',
    },
    confirmedAfterPayment: {
      subject: 'Paiement reçu, réservation confirmée ({reference})',
      heading: 'Paiement reçu',
      body: 'Merci ! Nous avons bien reçu votre paiement et votre réservation chez {site} est maintenant confirmée.',
    },
    awaitingPayment: {
      subject: 'Vos places sont réservées, paiement en attente ({reference})',
      heading: 'Vos places sont réservées',
      body: 'Merci d’avoir réservé chez {site}. Vos places sont gardées pour vous jusqu’à l’arrivée du paiement.',
    },
    expired: {
      subject: 'Votre réservation a expiré ({reference})',
      heading: 'Votre réservation a expiré',
      body: 'Nous n’avons pas reçu le paiement à temps ; les places gardées chez {site} ont donc été libérées. Vous pouvez réserver à nouveau s’il reste des places.',
    },
    cancelled: {
      subject: 'Votre réservation a été annulée ({reference})',
      heading: 'Votre réservation a été annulée',
      body: 'Votre réservation chez {site} a été annulée. Nous en sommes désolés.',
    },
    sessionCancelled: {
      subject: 'Une séance a été annulée ({reference})',
      heading: 'Une séance a été annulée',
      body: 'Nous sommes désolés : une séance à laquelle vous étiez inscrit(e) chez {site} n’aura pas lieu.',
    },
  },
}

// Machine-written (not proofread).
const nl: Messages = {
  hello: 'Hallo {firstName},',
  helloAnonymous: 'Hallo,',
  reference: 'Boekingsnummer',
  sessions: 'Uw sessies',
  amount: 'Bedrag',
  deadline: 'Rond de betaling af vóór {date}, anders worden de plaatsen weer vrijgegeven.',
  paymentHeading: 'Hoe te betalen',
  bankHeading: 'Bankgegevens',
  manage: 'Boeking beheren',
  manageHint: 'Met deze persoonlijke link kunt u uw boeking bekijken of annuleren. Deel de link niet met anderen.',
  linkFallback: 'Werkt de knop niet? Kopieer dan dit adres naar uw browser:',
  passHeading: 'Uw kaart',
  passLink: 'Mijn kaart openen',
  passLinkNumbered: 'Mijn kaart {n} openen',
  passHint: 'Met deze persoonlijke link laat u weten bij welke sessies u aanwezig bent. Deel de link niet met anderen.',
  outcome: {
    refund_review: 'U hebt deze boeking betaald. We nemen contact met u op over de terugbetaling.',
    credit: 'U hebt deze boeking betaald. Het bedrag wordt u tegoed geschreven; we nemen contact met u op.',
    none: 'Er is verder niets nodig van uw kant.',
  },
  cancelledSessionHeading: 'De geannuleerde sessie',
  replyHint: 'U kunt op deze e-mail antwoorden om {site} te bereiken.',
  footer: 'U ontvangt deze e-mail vanwege een boeking bij {site}.',
  testBanner: 'TESTVERZENDING. In productie zou dit naar de deelnemer gaan.',
  intents: {
    confirmed: {
      subject: 'Uw boeking is bevestigd ({reference})',
      heading: 'Uw boeking is bevestigd',
      body: 'Bedankt! Uw boeking bij {site} is bevestigd en uw plaatsen zijn gereserveerd.',
    },
    confirmedAfterPayment: {
      subject: 'Betaling ontvangen, boeking bevestigd ({reference})',
      heading: 'Betaling ontvangen',
      body: 'Bedankt! We hebben uw betaling ontvangen en uw boeking bij {site} is nu bevestigd.',
    },
    awaitingPayment: {
      subject: 'Uw plaatsen zijn gereserveerd, betaling volgt ({reference})',
      heading: 'Uw plaatsen zijn gereserveerd',
      body: 'Bedankt voor uw boeking bij {site}. Uw plaatsen blijven voor u vrij tot de betaling binnen is.',
    },
    expired: {
      subject: 'Uw reservering is verlopen ({reference})',
      heading: 'Uw reservering is verlopen',
      body: 'We hebben de betaling niet op tijd ontvangen, dus de gereserveerde plaatsen bij {site} zijn vrijgegeven. U kunt opnieuw boeken als er nog plaats is.',
    },
    cancelled: {
      subject: 'Uw boeking is geannuleerd ({reference})',
      heading: 'Uw boeking is geannuleerd',
      body: 'Uw boeking bij {site} is geannuleerd. Dat vinden we jammer.',
    },
    sessionCancelled: {
      subject: 'Een sessie is geannuleerd ({reference})',
      heading: 'Een sessie is geannuleerd',
      body: 'Het spijt ons: een sessie waarvoor u bij {site} was ingeschreven gaat niet door.',
    },
  },
}

// Machine-written (not proofread).
const es: Messages = {
  hello: 'Hola {firstName}:',
  helloAnonymous: 'Hola:',
  reference: 'Referencia de la reserva',
  sessions: 'Tus sesiones',
  amount: 'Importe',
  deadline: 'Por favor, completa el pago antes del {date}; de lo contrario, las plazas se liberarán.',
  paymentHeading: 'Cómo pagar',
  bankHeading: 'Datos bancarios',
  manage: 'Gestionar tu reserva',
  manageHint: 'Con este enlace personal puedes ver o cancelar tu reserva. Por favor, no lo compartas.',
  linkFallback: 'Si el botón no funciona, copia esta dirección en tu navegador:',
  passHeading: 'Tu bono',
  passLink: 'Abrir Mi bono',
  passLinkNumbered: 'Abrir Mi bono {n}',
  passHint: 'Con este enlace personal nos indicas a qué sesiones asistirás. Por favor, no lo compartas.',
  outcome: {
    refund_review: 'Has pagado esta reserva. Nos pondremos en contacto contigo para el reembolso.',
    credit: 'Has pagado esta reserva. El importe se te abonará como crédito; nos pondremos en contacto contigo.',
    none: 'No tienes que hacer nada más.',
  },
  cancelledSessionHeading: 'La sesión cancelada',
  replyHint: 'Puedes responder a este correo para contactar con {site}.',
  footer: 'Recibes este correo por una reserva en {site}.',
  testBanner: 'ENVÍO DE PRUEBA. En producción iría a la persona participante.',
  intents: {
    confirmed: {
      subject: 'Tu reserva está confirmada ({reference})',
      heading: 'Tu reserva está confirmada',
      body: '¡Gracias! Tu reserva en {site} está confirmada y tus plazas están reservadas.',
    },
    confirmedAfterPayment: {
      subject: 'Pago recibido, reserva confirmada ({reference})',
      heading: 'Pago recibido',
      body: '¡Gracias! Hemos recibido tu pago y tu reserva en {site} ya está confirmada.',
    },
    awaitingPayment: {
      subject: 'Tus plazas están reservadas, pago pendiente ({reference})',
      heading: 'Tus plazas están reservadas',
      body: 'Gracias por reservar en {site}. Mantenemos tus plazas hasta que llegue el pago.',
    },
    expired: {
      subject: 'Tu reserva ha caducado ({reference})',
      heading: 'Tu reserva ha caducado',
      body: 'No recibimos el pago a tiempo, así que las plazas que tenías en {site} se han liberado. Puedes volver a reservar si quedan plazas.',
    },
    cancelled: {
      subject: 'Tu reserva ha sido cancelada ({reference})',
      heading: 'Tu reserva ha sido cancelada',
      body: 'Tu reserva en {site} ha sido cancelada. Lo sentimos.',
    },
    sessionCancelled: {
      subject: 'Se ha cancelado una sesión ({reference})',
      heading: 'Se ha cancelado una sesión',
      body: 'Lo sentimos: una sesión a la que estabas inscrito/a en {site} no se celebrará.',
    },
  },
}

// Machine-written (not proofread). European Portuguese.
const pt: Messages = {
  hello: 'Olá {firstName},',
  helloAnonymous: 'Olá,',
  reference: 'Referência da reserva',
  sessions: 'As suas sessões',
  amount: 'Montante',
  deadline: 'Por favor, conclua o pagamento até {date}; caso contrário, os lugares serão libertados.',
  paymentHeading: 'Como pagar',
  bankHeading: 'Dados bancários',
  manage: 'Gerir a reserva',
  manageHint: 'Com esta ligação pessoal pode ver ou cancelar a sua reserva. Por favor, não a partilhe.',
  linkFallback: 'Se o botão não funcionar, copie este endereço para o seu navegador:',
  passHeading: 'O seu passe',
  passLink: 'Abrir O meu passe',
  passLinkNumbered: 'Abrir O meu passe {n}',
  passHint: 'Com esta ligação pessoal indica-nos a que sessões vai assistir. Por favor, não a partilhe.',
  outcome: {
    refund_review: 'Pagou esta reserva. Entraremos em contacto consigo sobre o reembolso.',
    credit: 'Pagou esta reserva. O valor será creditado a seu favor; entraremos em contacto consigo.',
    none: 'Não precisa de fazer mais nada.',
  },
  cancelledSessionHeading: 'A sessão cancelada',
  replyHint: 'Pode responder a este e-mail para contactar {site}.',
  footer: 'Recebe este e-mail por causa de uma reserva em {site}.',
  testBanner: 'ENVIO DE TESTE. Em produção seguiria para o participante.',
  intents: {
    confirmed: {
      subject: 'A sua reserva está confirmada ({reference})',
      heading: 'A sua reserva está confirmada',
      body: 'Obrigado! A sua reserva em {site} está confirmada e os seus lugares estão garantidos.',
    },
    confirmedAfterPayment: {
      subject: 'Pagamento recebido, reserva confirmada ({reference})',
      heading: 'Pagamento recebido',
      body: 'Obrigado! Recebemos o seu pagamento e a sua reserva em {site} está agora confirmada.',
    },
    awaitingPayment: {
      subject: 'Os seus lugares estão reservados, pagamento pendente ({reference})',
      heading: 'Os seus lugares estão reservados',
      body: 'Obrigado por reservar em {site}. Os seus lugares ficam guardados até o pagamento chegar.',
    },
    expired: {
      subject: 'A sua reserva expirou ({reference})',
      heading: 'A sua reserva expirou',
      body: 'Não recebemos o pagamento a tempo, por isso os lugares guardados em {site} foram libertados. Pode reservar de novo se ainda houver lugares.',
    },
    cancelled: {
      subject: 'A sua reserva foi cancelada ({reference})',
      heading: 'A sua reserva foi cancelada',
      body: 'A sua reserva em {site} foi cancelada. Lamentamos.',
    },
    sessionCancelled: {
      subject: 'Uma sessão foi cancelada ({reference})',
      heading: 'Uma sessão foi cancelada',
      body: 'Lamentamos: uma sessão em que estava inscrito/a em {site} não se vai realizar.',
    },
  },
}

export const DICTIONARIES = { en, it, de, fr, nl, es, pt } as const satisfies Record<string, Messages>
export type EmailLocale = keyof typeof DICTIONARIES
export const EMAIL_LOCALES = Object.keys(DICTIONARIES) as EmailLocale[]
