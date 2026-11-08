"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AppIcon } from "@/components/app/shell/AppIcon";
import { Button, IconButton } from "./Button";
import { DialogFrame } from "./DialogFrame";
import { EmptyState } from "./EmptyState";
import { Pill } from "./list/cells";
import { inputClass } from "./field-styles";
import { Skeleton } from "./Skeleton";
import { Switch } from "./Switch";

/**
 * The search / jump-to overlay of the Abluo App (ADR-047, ADR-030): one input,
 * grouped results, keyboard first. Presentational and language-agnostic: the
 * caller owns the query, the debounce, the data and every string.
 *
 *   • md+: a centred dialog near the top (≤ 640px wide, ≤ 70vh, results scroll).
 *   • Phones: a full-screen sheet; the input is at the top with a Cancel button
 *     and the keyboard opens at once.
 *
 * Combobox pattern: focus stays in the input; ↑/↓ move the active row
 * (`aria-activedescendant`), Enter opens it, Esc closes, hover sets it.
 * Rows are options, not buttons: choosing one calls its `onSelect` (the caller
 * navigates and closes).
 *
 *   <SearchPalette open={open} onClose={close} query={q} onQueryChange={setQ} groups={groups} state="ready" labels={labels} />
 */

export type SearchPaletteItem = {
  /** Unique within its group. */
  id: string;
  title: string;
  subtitle?: string;
  /** A small square thumbnail. */
  thumbUrl?: string;
  /** An `AppIcon` path, shown when there is no thumbnail. */
  icon?: string;
  /** A small status after the title (Draft / Archived). */
  badge?: { label: string; tone?: "muted" | "outline" };
  onSelect: () => void;
};

export type SearchPaletteGroup = {
  key: string;
  /** Already translated. */
  heading: string;
  items: SearchPaletteItem[];
  /** A last row, "See all in Posts". */
  seeAll?: { label: string; onSelect: () => void };
};

export type SearchPaletteLabels = {
  /** Names the dialog (read by screen readers; not drawn). */
  title: string;
  placeholder: string;
  /** Phones: the Cancel button. */
  close: string;
  /** Shown while loading with nothing to show yet, and read out. */
  loading: string;
  /** Already formatted with the query: Nothing found for “x”. */
  noResults: string;
  /** Shown after one typed character. */
  minChars?: string;
  error: string;
  retry: string;
  /** The archived toggle's label; omit `archived` to leave the toggle out. */
  showArchived: string;
  /** Keyboard hints in the footer (md+). */
  hintNavigate: string;
  hintOpen: string;
  hintClose: string;
};

export type SearchPaletteProps = {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  groups: SearchPaletteGroup[];
  /** ready · loading (previous results stay visible) · error. */
  state: "ready" | "loading" | "error";
  /** Reload after an error. */
  onRetry?: () => void;
  /** Show the "Show archived" switch. */
  archived?: { value: boolean; onChange: (next: boolean) => void };
  /** Show `labels.minChars` (the query is too short to search). */
  tooShort?: boolean;
  labels: SearchPaletteLabels;
};

type Row = { id: string; onSelect: () => void };

export function SearchPalette(props: SearchPaletteProps) {
  const { open, onClose, labels } = props;
  const titleId = useId();
  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      className="m-0 h-dvh max-h-none w-full max-w-none flex-col overflow-hidden bg-popover p-0 text-popover-foreground open:flex md:m-auto md:mt-[10vh] md:h-auto md:max-h-[70vh] md:w-[40rem] md:max-w-[calc(100vw-2rem)] md:rounded-2xl md:shadow-[var(--shadow-raise)] backdrop:bg-overlay"
    >
      <h2 id={titleId} className="sr-only">
        {labels.title}
      </h2>
      <PaletteBody {...props} />
    </DialogFrame>
  );
}

function PaletteBody({
  onClose,
  query,
  onQueryChange,
  groups,
  state,
  onRetry,
  archived,
  tooShort,
  labels,
}: SearchPaletteProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const rowId = (key: string) => `${uid}-opt-${key}`;
  const listRef = useRef<HTMLDivElement>(null);

  // Every selectable row in display order: the keyboard walks this list.
  const rows: (Row & { key: string })[] = groups.flatMap((g) => [
    ...g.items.map((it) => ({
      key: `${g.key}:${it.id}`,
      id: rowId(`${g.key}:${it.id}`),
      onSelect: it.onSelect,
    })),
    ...(g.seeAll
      ? [
          {
            key: `${g.key}:__all`,
            id: rowId(`${g.key}:__all`),
            onSelect: g.seeAll.onSelect,
          },
        ]
      : []),
  ]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeIndex = Math.max(
    0,
    rows.findIndex((r) => r.key === activeKey),
  );
  const active = rows[activeIndex];

  function move(delta: number, to?: number) {
    if (rows.length === 0) return;
    const next = to ?? (activeIndex + delta + rows.length) % rows.length;
    setActiveKey(rows[next].key);
    const el = document.getElementById(rows[next].id);
    el?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home" && rows.length > 0 && e.ctrlKey) {
      e.preventDefault();
      move(0, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      active?.onSelect();
    }
  }

  const loadingEmpty = state === "loading" && groups.length === 0;
  const noResults =
    state === "ready" &&
    groups.length === 0 &&
    query.trim().length > 0 &&
    !tooShort;
  let status = "";
  if (state === "loading") status = labels.loading;
  else if (state === "error") status = labels.error;
  else if (noResults) status = labels.noResults;

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2 md:px-4">
        <span className="relative block min-w-0 flex-1">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
            <AppIcon d={SEARCH_ICON} size={18} />
          </span>
          <input
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={active?.id}
            aria-autocomplete="list"
            aria-label={labels.placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            autoFocus
            maxLength={100}
            value={query}
            placeholder={labels.placeholder}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            className={inputClass({
              controlSize: "md",
              flush: true,
              className: "border-0 bg-transparent pl-10 focus-visible:ring-0",
            })}
          />
        </span>
        <Button variant="quiet" className="md:hidden" onClick={onClose}>
          {labels.close}
        </Button>
        <IconButton
          aria-label={labels.close}
          onClick={onClose}
          className="hidden md:inline-grid"
        >
          <AppIcon d="M6 6l12 12M18 6L6 18" size={18} />
        </IconButton>
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={labels.title}
        aria-busy={state === "loading"}
        // Keep the input focused: clicking a row must not blur it first.
        onMouseDown={(e) => e.preventDefault()}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 md:px-3"
      >
        {groups.map((g) => (
          <div
            key={g.key}
            role="group"
            aria-labelledby={rowId(`h-${g.key}`)}
            className="pb-2"
          >
            <p
              id={rowId(`h-${g.key}`)}
              className="px-2 pt-2 pb-1 text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase"
            >
              {g.heading}
            </p>
            {g.items.map((it) => {
              const key = `${g.key}:${it.id}`;
              return (
                <Option
                  key={key}
                  id={rowId(key)}
                  active={active?.key === key}
                  onActivate={() => setActiveKey(key)}
                  onSelect={it.onSelect}
                >
                  <Lead item={it} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 truncate text-[0.9375rem] leading-6 font-medium text-foreground">
                        {it.title}
                      </span>
                      {it.badge ? (
                        <Pill tone={it.badge.tone ?? "muted"}>
                          {it.badge.label}
                        </Pill>
                      ) : null}
                    </span>
                    {it.subtitle ? (
                      <span className="block truncate text-sm leading-5 text-muted-foreground">
                        {it.subtitle}
                      </span>
                    ) : null}
                  </span>
                </Option>
              );
            })}
            {g.seeAll ? (
              <Option
                id={rowId(`${g.key}:__all`)}
                active={active?.key === `${g.key}:__all`}
                onActivate={() => setActiveKey(`${g.key}:__all`)}
                onSelect={g.seeAll.onSelect}
              >
                <span className="mt-0.5 size-6 shrink-0 text-muted-foreground">
                  <AppIcon d="M5 12h14M13 6l6 6-6 6" size={20} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.9375rem] leading-6 text-muted-foreground">
                  {g.seeAll.label}
                </span>
              </Option>
            ) : null}
          </div>
        ))}

        {loadingEmpty ? (
          <div aria-label={labels.loading} className="space-y-1 px-2 py-1">
            {[0, 1, 2].map((n) => (
              <div key={n} className="flex items-start gap-3 py-2.5">
                <Skeleton
                  shape="block"
                  className="size-10 shrink-0 rounded-lg"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3.5 w-3/5" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {state === "error" ? (
          <EmptyState
            compact
            titleAs="p"
            title={labels.error}
            action={
              onRetry ? (
                <Button variant="secondary" onClick={onRetry}>
                  {labels.retry}
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {noResults ? (
          <EmptyState compact titleAs="p" title={labels.noResults} />
        ) : null}
        {tooShort && labels.minChars ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            {labels.minChars}
          </p>
        ) : null}
      </div>

      <p role="status" className="sr-only">
        {status}
      </p>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border-subtle px-4 py-1 md:py-1.5">
        {archived ? (
          <ArchivedToggle
            value={archived.value}
            onChange={archived.onChange}
            label={labels.showArchived}
          />
        ) : (
          <span />
        )}
        <div
          className="hidden items-center gap-4 text-xs text-muted-foreground md:flex"
          aria-hidden="true"
        >
          <Hint keys="↑ ↓">{labels.hintNavigate}</Hint>
          <Hint keys="⏎">{labels.hintOpen}</Hint>
          <Hint keys="esc">{labels.hintClose}</Hint>
        </div>
      </div>
    </>
  );
}

const SEARCH_ICON = "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5";

function Option({
  id,
  active,
  onActivate,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  onActivate: () => void;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseMove={active ? undefined : onActivate}
      onClick={onSelect}
      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 ${active ? "bg-hover" : ""}`}
    >
      {children}
    </div>
  );
}

function Lead({ item }: { item: SearchPaletteItem }) {
  if (item.thumbUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a 40px result thumbnail from a CDN URL the server already sized
    return (
      <img
        src={item.thumbUrl}
        alt=""
        loading="lazy"
        className="size-10 shrink-0 rounded-lg bg-muted object-cover"
      />
    );
  }
  if (item.icon) {
    return (
      <span className="mt-0.5 size-6 shrink-0 text-muted-foreground">
        <AppIcon d={item.icon} size={20} />
      </span>
    );
  }
  return null;
}

function ArchivedToggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <Switch checked={value} onChange={onChange} labelledBy={id} />
      <span id={id} className="text-sm text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans text-[0.6875rem] text-foreground">
        {keys}
      </kbd>
      {children}
    </span>
  );
}
