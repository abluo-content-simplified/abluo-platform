# No!Logo — content changes proposed before the DNS cutover

Nothing in this file has been written to Sanity. Every value below is either
copy that already exists in the project in that language, or a mechanical move
of an existing value into a field better suited to it. Where a genuinely new
string is unavoidable it is marked **NEW** and needs Tom's sign-off.

Applies to: `page-nologo-restaurant`, `page-nologo-home`, `siteconfig-nologo`,
`ds-nologo`.

---

## 1. Split `title` from `seoTitle` on the restaurant page

`page.title` is currently doing two jobs. Six of its seven locales hold a long
search title; English holds a short name. The renderer uses `title` for the
`<title>` tag *and* would use it for a nav label, and those want different
strings.

With the new `seoTitle` field the split is clean, and **no wording changes** —
the long strings move across as they are.

| locale | `seoTitle` (moved, unchanged) | `title` (short name) |
|---|---|---|
| en | Restaurant Booking System — No!Logo | Restaurant Booking System |
| it | Sistema Prenotazioni Ristorante Senza Commissioni \| No!Logo | Sistema Prenotazioni Ristorante |
| de | Reservierungssystem Restaurant ohne Provisionen \| No!Logo | Reservierungssystem Restaurant |
| fr | Système de réservation restaurant sans commission \| No!Logo | Système de réservation restaurant |
| es | Sistema de reservas sin comisiones \| No!Logo | Sistema de reservas |
| nl | Reserveringssysteem zonder commissies \| No!Logo | Reserveringssysteem |
| pt | Sistema de reservas restaurante sem comissões | Sistema de reservas restaurante |

The `title` column is each `seoTitle` with the keyword tail and the brand
suffix trimmed — no new words. English gains a `— No!Logo` suffix in `seoTitle`
so all seven are consistent; that is the **only** change of wording, and it is
the brand name.

---

## 2. Meta description for the restaurant page — assembled, not written

The page has no description in any language, and the slug route could not emit
one until this branch. Rather than write seven new descriptions, each is the
page's own hero subheadline followed by its own tagline — both already
published, both already translated, both already approved by you.

| locale | `seoDescription` |
|---|---|
| en | A modern booking system for restaurants. Simple, fast, and fully under your control. No setup hassle. We configure everything for you. |
| it | Un sistema di prenotazione moderno per il tuo ristorante. Semplice, veloce e sotto il tuo controllo. Configuriamo tutto noi. |
| de | Ein modernes Reservierungssystem für Restaurants. Klar, effizient und vollständig unter Ihrer Kontrolle. Kein Einrichtungsaufwand. Wir konfigurieren alles für Sie. |
| fr | Un système moderne, simple et sous votre maîtrise. Aucune installation compliquée. Nous configurons tout pour vous. |
| es | Un sistema de reservas moderno para restaurantes. Simple, rápido y totalmente bajo tu control. Sin complicaciones de instalación. Lo configuramos todo por ti. |
| nl | Een modern reserveringssysteem voor restaurants. Simpel, snel en volledig onder jouw controle. Geen gedoe met de installatie. Wij configureren alles voor je. |
| pt | Um sistema de reservas moderno para restaurantes. Simples, rápido e totalmente sob o seu controlo. Sem complicações de configuração. Configuramos tudo por si. |

German runs to 168 characters and Google will truncate the tail; the first
sentence carries the meaning, so the truncation costs nothing. French is short
because the source subheadline is short — worth a look when you next touch that
page, but it is your sentence and I have not padded it.

**The home page needs nothing.** `siteConfig.seoDefaultDescription` is already
authored in all seven languages and is a good description; the home page
inherits it.

---

## 3. Link the restaurant page — it is currently an orphan

Every nav link and all sixteen footer links are in-page anchors. Nothing on the
site links to `/restaurant-booking-system`. It is reachable only from the
sitemap, so it gets no internal link equity and reads to a crawler as a page
nobody references.

**Nav** — one new entry, `linkType: page`, `pageRef: page-nologo-restaurant`,
placed after "Product". Label = the short `title` from §1, so nothing new is
written:

| locale | label |
|---|---|
| en | Restaurant Booking System |
| it | Sistema Prenotazioni Ristorante |
| de | Reservierungssystem Restaurant |
| fr | Système de réservation restaurant |
| es | Sistema de reservas |
| nl | Reserveringssysteem |
| pt | Sistema de reservas restaurante |

**NEW — needs your call.** If you would rather the nav read "For Restaurants"
(shorter, and the nav is tight at seven languages), say so and I will use that
instead; it is a new phrase in seven languages, which is why I have not assumed
it.

**Footer** — the "Product" column's four links all point at `#product` on the
home page. Repointing the first of them, "Reservation Management", at the
restaurant page costs nothing and gives the page a second internal link. No
label changes.

---

## 4. Dead links: Privacy Policy and Legal

Both sit in `footerLinks` with `linkType: anchor` and **no anchor ID**, so both
render as `href="#"` and go nowhere. For an EU B2B site this is also a
compliance gap, and it is one of the trust signals both Google and the answer
engines look for.

Two pages are needed. I have not drafted either: privacy text is a legal
document about your actual data handling, and inventing one would be worse than
having none. What the platform needs from you:

- a privacy policy covering the demo form (what is collected, where it is
  stored — Supabase — and for how long), and
- an imprint / legal page with the operating entity behind No!Logo.

Give me the text and I will create both pages in all seven languages and point
the footer links at them.

---

## 5. Structured data values

| document | field | value | why |
|---|---|---|---|
| `siteconfig-nologo` | `businessType` | `Organization` | Currently unset, so it fell back to `LocalBusiness` — which asserts a physical place of business open to customers. No!Logo has none. |
| `siteconfig-nologo` | `addressCountry` | *(leave empty)* | No address is set, so nothing to qualify. |
| `siteconfig-nologo` | `openGraphImage` | **NEEDED** — 1200 × 630 JPG | Unset, so no `og:image` and no Twitter card. Every LinkedIn share renders bare, and LinkedIn is the only social channel on the site. |

Also worth knowing, though outside No!Logo: `businessType` was projected only
by `siteConfigFaviconQuery`, which the JSON-LD component never calls — so the
value an editor set in Studio never reached the structured data. Hoffmann is set
to `Psychologist` and was being published as `LocalBusiness` regardless. Fixed
on this branch.

**Two other tenants now need an explicit type**, because the default changed
from `LocalBusiness` to `Organization`:

- Studio Martegani → `Dentist` (it is a dental practice, and `Dentist` is
  strictly better for it than the old generic default)
- Livener → `Organization`, and `addressCountry: GB` — its footer says
  "Registered in England", and the old hardcoded `IT` was wrong for it.

---

## 6. After the DNS change

Not doable before, listed so it is not lost:

- `redirectFrom` entries for the old `?lang=` URLs
- Google Search Console + Bing Webmaster Tools verification into
  `siteconfig-nologo.googleSiteVerification` / `bingSiteVerification`
- submit `https://nologo.cloud/sitemap.xml`
