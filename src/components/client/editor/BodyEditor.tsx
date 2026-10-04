'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  defineSchema,
  EditorProvider,
  PortableTextEditable,
  useEditor,
  useEditorSelector,
  type PortableTextBlock,
  type RenderDecoratorFunction,
  type RenderStyleFunction,
} from '@portabletext/editor'
import { EventListenerPlugin } from '@portabletext/editor/plugins'
import * as selectors from '@portabletext/editor/selectors'

/**
 * Body editor for the Create flow — "Tell your story" (ADR-025 D6).
 *
 * Native Portable Text: what the writer types is stored as-is in
 * `post.body[locale]` (localizedPortableText), with no HTML conversion.
 * The schema is deliberately small: what a practice owner needs on a phone
 * (headings, bold, italic, lists, quote). Links, images and AI tools join in S3+.
 *
 * Emits the full value on every change; the autosave engine (S2) debounces it.
 */
export const bodySchema = defineSchema({
  decorators: [{ name: 'strong' }, { name: 'em' }],
  styles: [{ name: 'normal' }, { name: 'h2' }, { name: 'h3' }, { name: 'blockquote' }],
  lists: [{ name: 'bullet' }, { name: 'number' }],
  annotations: [],
  inlineObjects: [],
  blockObjects: [],
})

const renderStyle: RenderStyleFunction = (props) => {
  switch (props.value) {
    case 'h2':
      return <h2 className="mt-6 mb-2 text-2xl font-semibold tracking-tight">{props.children}</h2>
    case 'h3':
      return <h3 className="mt-5 mb-1 text-xl font-semibold">{props.children}</h3>
    case 'blockquote':
      return (
        <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground">{props.children}</blockquote>
      )
    default:
      return <p className="my-3">{props.children}</p>
  }
}

const renderDecorator: RenderDecoratorFunction = (props) => {
  if (props.value === 'strong') return <strong className="font-semibold">{props.children}</strong>
  if (props.value === 'em') return <em>{props.children}</em>
  return <>{props.children}</>
}

function ToolButton({
  label,
  active,
  onPress,
  children,
}: {
  label: string
  active: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      // Keep focus (and the phone keyboard) in the text while tapping a tool.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={`grid h-11 min-w-11 place-items-center rounded-md px-2 text-[15px] font-semibold transition-colors ${
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function Toolbar() {
  const t = useTranslations('editor.body')
  const editor = useEditor()
  const isH2 = useEditorSelector(editor, selectors.isActiveStyle('h2'))
  const isQuote = useEditorSelector(editor, selectors.isActiveStyle('blockquote'))
  const isBold = useEditorSelector(editor, selectors.isActiveDecorator('strong'))
  const isItalic = useEditorSelector(editor, selectors.isActiveDecorator('em'))
  const isBullet = useEditorSelector(editor, selectors.isActiveListItem('bullet'))
  const isNumber = useEditorSelector(editor, selectors.isActiveListItem('number'))

  const send = (event: Parameters<typeof editor.send>[0]) => {
    editor.send(event)
    editor.send({ type: 'focus' })
  }
  const icon = (d: string) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )

  return (
    <div role="toolbar" aria-label={t('toolbar')} className="flex items-center gap-0.5 overflow-x-auto">
      <ToolButton label={t('heading')} active={isH2} onPress={() => send({ type: 'style.toggle', style: 'h2' })}>H</ToolButton>
      <ToolButton label={t('bold')} active={isBold} onPress={() => send({ type: 'decorator.toggle', decorator: 'strong' })}>B</ToolButton>
      <ToolButton label={t('italic')} active={isItalic} onPress={() => send({ type: 'decorator.toggle', decorator: 'em' })}>
        <span className="font-medium italic">I</span>
      </ToolButton>
      <ToolButton label={t('bulletList')} active={isBullet} onPress={() => send({ type: 'list item.toggle', listItem: 'bullet' })}>
        {icon('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01')}
      </ToolButton>
      <ToolButton label={t('numberedList')} active={isNumber} onPress={() => send({ type: 'list item.toggle', listItem: 'number' })}>
        {icon('M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1')}
      </ToolButton>
      <ToolButton label={t('quote')} active={isQuote} onPress={() => send({ type: 'style.toggle', style: 'blockquote' })}>
        {icon('M3 21c3 0 7-1 7-8V5H3v7h4c0 4-2 5-4 5M14 21c3 0 7-1 7-8V5h-7v7h4c0 4-2 5-4 5')}
      </ToolButton>
    </div>
  )
}

export function BodyEditor({
  initialValue,
  onChange,
}: {
  initialValue?: PortableTextBlock[]
  onChange?: (value: PortableTextBlock[] | undefined) => void
}) {
  const t = useTranslations('editor.body')
  const [focused, setFocused] = useState(false)

  return (
    <EditorProvider initialConfig={{ schemaDefinition: bodySchema, initialValue }}>
      <EventListenerPlugin
        on={(event) => {
          if (event.type === 'mutation') onChange?.(event.value)
          if (event.type === 'focused') setFocused(true)
          if (event.type === 'blurred') setFocused(false)
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <PortableTextEditable
          aria-label={t('label')}
          className="min-h-[40vh] flex-1 text-[17px] leading-7 text-foreground outline-none [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
          renderStyle={renderStyle}
          renderDecorator={renderDecorator}
          renderPlaceholder={() => <span className="text-muted-foreground">{t('placeholder')}</span>}
        />
        {/* Sticky above the phone keyboard; the step's own footer stays below. */}
        <div
          data-focused={focused || undefined}
          className="sticky bottom-0 border-t border-border-subtle bg-background py-1 pb-[env(safe-area-inset-bottom)]"
        >
          <Toolbar />
        </div>
      </div>
    </EditorProvider>
  )
}
