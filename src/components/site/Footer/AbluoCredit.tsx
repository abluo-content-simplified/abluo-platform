import { AbluoLogo } from '@/components/app/shell/AbluoLogo'
import { getAbluoCreditMessages } from '@/lib/i18n/abluo-credit-messages'

/**
 * "Made with a little help from abluo." — Abluo's credit in a website footer.
 * Switched on per project by Abluo (`project.showAbluoCredit`), never by the
 * tenant. The whole line is one link: a bigger target than the logo alone, and
 * its accessible name reads as the sentence.
 *
 * The letters follow the footer's muted ink (currentColor); the dot stays the
 * brand blue. `--brand` is only defined inside the dashboards (`.abluo-app`),
 * so it is set here for the website.
 */
const ABLUO_URL = 'https://abluo.app'
const BRAND_BLUE = 'oklch(0.5757 0.2332 260.4)' // #0A6CFF — same value as --brand in globals.css

export function AbluoCredit({ locale, className = '' }: { locale: string; className?: string }) {
  const m = getAbluoCreditMessages(locale)
  return (
    <a
      href={ABLUO_URL}
      target="_blank"
      rel="noopener"
      className={`inline-flex items-center gap-[0.35em] text-sm hover:text-[var(--color-footer-text)] ${className}`}
      style={{ color: 'var(--color-footer-text-muted)', ['--brand' as string]: BRAND_BLUE }}
    >
      {m.before && <span>{m.before}</span>}
      <AbluoLogo className="h-[0.95em] translate-y-[0.08em]" label="abluo" />
      {m.after && <span>{m.after}</span>}
    </a>
  )
}
