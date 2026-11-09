'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '@/components/icons'
import { formatDigitalCardSiteMessage, type DigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'

/** Printed / scanned: black on white whatever the site's theme (D12). */
const QR_COLORS = { dark: '#000000ff', light: '#ffffffff' }
const FOCUS = 'outline-offset-2 focus-visible:outline focus-visible:outline-2'
const FOCUS_STYLE: CSSProperties = { outlineColor: 'var(--color-primary)' }

/**
 * "Show QR code" on a public Digital Card (ADR-049 Amendment A): a small
 * button that opens the card's OWN code — its canonical address with
 * `?src=qr` — large, in a modal dialog, so someone across the desk can scan it
 * from the screen. Drawn in the browser with `qrcode` (nothing is fetched).
 * Not a card link: no `data-card-link`, so it is never counted as a click.
 *
 * The native <dialog> gives the modal semantics: focus moves in, Escape and
 * the Close button close it, focus returns to the button, the page behind is
 * inert. Every colour is a design-system variable.
 */
export function CardQrButton({ url, address, messages }: { url: string; address: string; messages: DigitalCardSiteMessages }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [svg, setSvg] = useState<string | 'failed' | null>(null)

  useEffect(() => {
    if (!open || svg) return
    let live = true
    void (async () => {
      try {
        const QRCode = (await import('qrcode')).default
        const out = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: QR_COLORS })
        if (live) setSvg(out)
      } catch {
        if (live) setSvg('failed')
      }
    })()
    return () => {
      live = false
    }
  }, [open, svg, url])

  const show = () => {
    setOpen(true)
    dialogRef.current?.showModal()
  }
  const close = () => dialogRef.current?.close()

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        className={`inline-flex min-h-11 items-center gap-2 px-3 py-2 text-sm font-medium transition-opacity hover:opacity-80 ${FOCUS}`}
        style={{ ...FOCUS_STYLE, color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}
      >
        <Icon name="qr-code" size={18} />
        {messages.showQr}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="card-qr-title"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A tap on the backdrop (outside the panel) closes it.
          if (e.target === dialogRef.current) close()
        }}
        className="m-auto w-[min(92vw,26rem)] p-0 backdrop:bg-black/60"
        style={{
          backgroundColor: 'var(--color-surface, var(--color-background))',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md, 12px)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <div className="flex flex-col items-center gap-4 p-5 text-center">
          <h2 id="card-qr-title" style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', fontWeight: 600 }}>
            {messages.qrTitle}
          </h2>
          {svg === 'failed' ? (
            <p role="alert">{messages.qrFailed}</p>
          ) : svg ? (
            // eslint-disable-next-line @next/next/no-img-element -- a generated data: SVG
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
              alt={formatDigitalCardSiteMessage(messages.qrAlt, { address })}
              width={320}
              height={320}
              className="aspect-square w-full max-w-80"
              style={{ borderRadius: 'var(--radius-md, 12px)' }}
            />
          ) : (
            <div aria-hidden="true" className="aspect-square w-full max-w-80" style={{ backgroundColor: '#ffffff', borderRadius: 'var(--radius-md, 12px)' }} />
          )}
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {messages.qrHint}
          </p>
          <p className="break-all text-sm font-medium" translate="no">
            {address}
          </p>
          <button
            type="button"
            onClick={close}
            className={`flex min-h-12 w-full items-center justify-center px-5 py-3 text-base font-semibold transition-opacity hover:opacity-90 ${FOCUS}`}
            style={{
              ...FOCUS_STYLE,
              backgroundColor: 'var(--btn-secondary-bg, var(--color-surface))',
              color: 'var(--btn-secondary-text, var(--color-text-primary))',
              borderRadius: 'var(--radius-btn, var(--radius-md))',
              border: '1px solid var(--color-border)',
            }}
          >
            {messages.close}
          </button>
        </div>
      </dialog>
    </>
  )
}
