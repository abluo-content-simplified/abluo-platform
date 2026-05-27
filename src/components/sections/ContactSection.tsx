import type { ContactSection, WebsiteSiteConfig } from '@/lib/sanity/types'

interface Props {
  section: ContactSection
  siteConfig?: WebsiteSiteConfig | null
}

export function ContactSection({ section, siteConfig }: Props) {
  const { title, subtitle, mapEmbedUrl } = section

  return (
    <section id="contatti" className="bg-white px-6 py-24 md:px-16 lg:px-24">
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid gap-16 md:grid-cols-2">
          {/* Left: contact details */}
          <div>
            {title && (
              <h2 className="mb-6 text-3xl font-semibold leading-snug tracking-tight text-zinc-900 md:text-4xl">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mb-10 text-base leading-relaxed text-zinc-500">{subtitle}</p>
            )}

            <div className="space-y-6">
              {siteConfig?.address && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                    Indirizzo
                  </p>
                  <p className="text-sm text-zinc-700">{siteConfig.address}</p>
                </div>
              )}
              {siteConfig?.phone && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                    Telefono
                  </p>
                  <a
                    href={`tel:${siteConfig.phone}`}
                    className="text-sm text-zinc-700 transition-colors hover:text-zinc-900"
                  >
                    {siteConfig.phone}
                  </a>
                </div>
              )}
              {siteConfig?.email && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                    Email
                  </p>
                  <a
                    href={`mailto:${siteConfig.email}`}
                    className="text-sm text-zinc-700 transition-colors hover:text-zinc-900"
                  >
                    {siteConfig.email}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Right: map */}
          <div className="flex flex-col">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
              Come arrivare
            </p>
            {mapEmbedUrl ? (
              <iframe
                src={mapEmbedUrl}
                className="h-72 w-full border-0 grayscale"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Mappa dello studio"
              />
            ) : (
              /* Placeholder until real embed URL is configured in Sanity */
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(siteConfig?.address ?? 'Via Cascina Sirone 12, Azzate VA')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-72 w-full flex-col items-center justify-center gap-3 bg-zinc-50 transition-colors hover:bg-zinc-100"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200">
                  <svg
                    className="h-5 w-5 text-zinc-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                    />
                  </svg>
                </div>
                <p className="text-xs text-zinc-400">Apri in Google Maps</p>
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
