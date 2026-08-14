// ─── Shared article PortableText components ───────────────────────────────────
//
// The component map used to render long-form article bodies: semantic HTML
// styled entirely through design-system CSS variables, so every tenant's
// typography and colours apply automatically.
//
// Extracted in ADR-020. This map previously lived inline in the blog detail
// route. The News module's detail route renders the same kind of body, and
// copying seventy-odd lines of presentational JSX would have guaranteed the two
// drifted — a heading style fixed in one and not the other. Neither route owns
// article typography; the design system does.
//
// Purely presentational: no data fetching, no module or tenant awareness. Any
// content type with a localizedPortableText body can use it.

export const articlePortableTextComponents = {
  block: {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-3xl font-bold mt-10 mb-4" style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}>
        {children}
      </h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="text-2xl font-semibold mt-8 mb-3" style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}>
        {children}
      </h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-xl font-semibold mt-6 mb-2" style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}>
        {children}
      </h3>
    ),
    normal: ({ children }: { children?: React.ReactNode }) => (
      <p className="text-base leading-relaxed mb-5" style={{ color: 'var(--color-text-primary)' }}>
        {children}
      </p>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote
        className="pl-5 py-1 my-6 text-lg italic"
        style={{ borderLeft: '3px solid var(--color-primary)', color: 'var(--color-text-secondary)' }}
      >
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc pl-6 mb-5 space-y-2" style={{ color: 'var(--color-text-primary)' }}>
        {children}
      </ul>
    ),
    number: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal pl-6 mb-5 space-y-2" style={{ color: 'var(--color-text-primary)' }}>
        {children}
      </ol>
    ),
  },
  listItem: {
    bullet: ({ children }: { children?: React.ReactNode }) => (
      <li className="text-base leading-relaxed">{children}</li>
    ),
    number: ({ children }: { children?: React.ReactNode }) => (
      <li className="text-base leading-relaxed">{children}</li>
    ),
  },
  marks: {
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
    code: ({ children }: { children?: React.ReactNode }) => (
      <code
        className="px-1.5 py-0.5 rounded text-sm font-mono"
        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-primary)' }}
      >
        {children}
      </code>
    ),
    link: ({ value, children }: { value?: { href?: string; blank?: boolean }; children?: React.ReactNode }) => (
      <a
        href={value?.href}
        target={value?.blank ? '_blank' : undefined}
        rel={value?.blank ? 'noopener noreferrer' : undefined}
        style={{ color: 'var(--color-primary)' }}
        className="underline underline-offset-2 hover:opacity-75 transition-opacity"
      >
        {children}
      </a>
    ),
  },
}
