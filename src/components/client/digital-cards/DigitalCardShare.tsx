'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { qrTarget, taggedLink } from '@/lib/modules/digital-cards/model'
import { digitalCardSourceName, formatDigitalCardsMessage, getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { Button } from '@/components/app/ui/Button'
import { buttonClass } from '@/components/app/ui/button-styles'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { Skeleton } from '@/components/app/ui/Skeleton'

const H2 = 'text-[1.0625rem] leading-7 font-semibold text-foreground'
/** D12 — black on white, whatever the theme: it is printed. */
const QR_COLORS = { dark: '#000000ff', light: '#ffffffff' }
const TAGGED_SOURCES = ['instagram', 'linkedin', 'facebook', 'whatsapp', 'email', 'print'] as const

/**
 * QR code (D12) and tagged share links (D11) of one card. Both encode the
 * project's canonical address (ADR-034, https://www.<domain>) — never a
 * preview host — so a site without its own domain gets an explanation
 * instead. The QR code is drawn in the browser with `qrcode` (SVG + PNG),
 * encoding `<origin><path>?src=qr`.
 */
export function DigitalCardShare({
  origin,
  path,
  fileName,
  ready,
  live,
}: {
  /** https://www.<domain>, or null while the site has no domain. */
  origin: string | null
  /** `/link` or `/link/<urlName>`. */
  path: string
  /** Download name without extension. */
  fileName: string
  /** The card has an address (a person card needs its URL name). */
  ready: boolean
  /** The card is on the website now. */
  live: boolean
}) {
  const m = getDigitalCardsMessages(useLocale())
  const e = m.editor
  const target = origin && ready ? qrTarget(origin, path) : null
  const address = origin ? `${origin}${path}` : path
  const [qr, setQr] = useState<{ target: string; svg: string; png: string } | 'failed' | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    let live = true
    void (async () => {
      try {
        const QRCode = (await import('qrcode')).default
        const options = { margin: 2, errorCorrectionLevel: 'M' as const, color: QR_COLORS }
        const [svg, png] = await Promise.all([QRCode.toString(target, { ...options, type: 'svg' }), QRCode.toDataURL(target, { ...options, width: 1024 })])
        if (live) setQr({ target, svg, png })
      } catch {
        if (live) setQr('failed')
      }
    })()
    return () => {
      live = false
    }
  }, [target])

  const current = qr && qr !== 'failed' && qr.target === target ? qr : null
  const svgHref = current ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(current.svg)}` : null

  async function copy(source: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(source)
      setTimeout(() => setCopied((c) => (c === source ? null : c)), 2000)
    } catch {
      setCopied(null)
    }
  }

  return (
    <>
      <Panel as="section" aria-labelledby="card-qr" className="space-y-3" id="card-qr-section">
        <h2 id="card-qr" className={H2}>
          {e.qrTitle}
        </h2>
        {!origin ? (
          <Notice tone="info">{e.qrNoDomain}</Notice>
        ) : !ready ? (
          <Notice tone="info">{e.qrNoUrlName}</Notice>
        ) : (
          <>
            <p className="text-sm leading-5 break-words text-muted-foreground">{formatDigitalCardsMessage(e.qrHint, { address })}</p>
            {qr === 'failed' ? (
              <Notice tone="error">{e.qrFailed}</Notice>
            ) : (
              <div className="flex flex-col items-start gap-3 sm:flex-row">
                {svgHref ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a generated data: SVG
                  <img src={svgHref} alt={formatDigitalCardsMessage(e.qrAlt, { address })} width="160" height="160" className="size-40 shrink-0 rounded-xl border border-border" />
                ) : (
                  <Skeleton shape="block" className="size-40 shrink-0" />
                )}
                <div className="flex flex-wrap gap-2 sm:flex-col">
                  {svgHref && current ? (
                    <>
                      <a href={svgHref} download={`${fileName}-qr.svg`} className={buttonClass({ variant: 'secondary' })}>
                        {e.qrSvg}
                      </a>
                      <a href={current.png} download={`${fileName}-qr.png`} className={buttonClass({ variant: 'secondary' })}>
                        {e.qrPng}
                      </a>
                    </>
                  ) : null}
                </div>
              </div>
            )}
            {!live ? <p className="text-sm leading-5 text-muted-foreground">{e.qrNotLive}</p> : null}
          </>
        )}
      </Panel>

      <Panel as="section" aria-labelledby="card-tagged" className="space-y-3">
        <h2 id="card-tagged" className={H2}>
          {e.taggedTitle}
        </h2>
        {!origin ? (
          <Notice tone="info">{e.qrNoDomain}</Notice>
        ) : !ready ? (
          <Notice tone="info">{e.qrNoUrlName}</Notice>
        ) : (
          <>
            <p className="text-sm leading-5 text-muted-foreground">{e.taggedHint}</p>
            <ul className="divide-y divide-border-subtle">
              {TAGGED_SOURCES.map((source) => {
                const url = taggedLink(origin, path, source)
                const name = digitalCardSourceName(m, source)
                return (
                  <li key={source} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-[0.9375rem] leading-6 font-medium text-foreground">{name}</span>
                      <span className="block text-sm leading-5 break-all text-muted-foreground" translate="no">
                        {url}
                      </span>
                    </span>
                    <Button aria-label={formatDigitalCardsMessage(e.copyFor, { source: name })} onClick={() => void copy(source, url)}>
                      {copied === source ? e.copiedShort : e.copy}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Panel>
    </>
  )
}
