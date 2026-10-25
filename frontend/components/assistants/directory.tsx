"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AssistantIcon } from "@/components/assistants/icons";
import { ArrowIcon, SearchIcon } from "@/components/shell/icons";
import { toneStyle } from "@/components/ui/primitives";
import type { AssistantGroup } from "@/lib/assistants/catalog";

export type DirectoryItem = {
  id: string;
  icon: string;
  name: string;
  description: string;
  starters: string[];
  uses: string[];
  hue: number;
  chroma?: number;
  group: AssistantGroup;
  ready: boolean;
};

type Filter = "all" | AssistantGroup;

type Copy = {
  filterLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  noMatch: string;
  goodFor: string;
  tryAsking: string;
  startChat: string;
  comingSoon: string;
  comingSoonBody: string;
  groups: Record<Filter, string>;
};

const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");

/**
 * The assistant explorer: search and group filters, tone-coloured cards, and on large
 * screens a preview panel that follows hover and keyboard focus. Every card is one link
 * into that assistant's workspace, so the preview is an enhancement, never required.
 */
export function AssistantDirectory({ items, copy }: { items: DirectoryItem[]; copy: Copy }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState(items.find((i) => i.ready)?.id ?? items[0]?.id);
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return items.filter(
      (i) =>
        (filter === "all" || i.group === filter) &&
        (!q || fold([i.name, i.description, ...i.uses, ...i.starters].join(" ")).includes(q)),
    );
  }, [items, filter, query]);
  const preview = items.find((i) => i.id === previewId) ?? items[0];
  const order: Filter[] = ["all", "people", "work", "mind", "everyday"];

  return (
    <div className="space-y-6">
      <div className="enter enter-2 flex flex-col gap-3 md:flex-row md:items-center">
        <label className="glass relative flex min-h-12 flex-1 items-center gap-3 rounded-full px-4 shadow-soft focus-within:ring-2 focus-within:ring-focus">
          <span className="sr-only">{copy.searchLabel}</span>
          <SearchIcon className="h-5 w-5 shrink-0 text-ink-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.searchPlaceholder}
            dir="auto"
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
          />
        </label>
        <div role="radiogroup" aria-label={copy.filterLabel} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scroll-quiet md:pb-0">
          {order.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className="min-h-11 shrink-0 rounded-full border border-line bg-surface/70 px-4 text-sm font-semibold text-ink-muted transition-all duration-200 hover:text-ink aria-checked:border-transparent aria-checked:bg-ink aria-checked:text-canvas"
            >
              {copy.groups[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        {shown.length === 0 ? (
          <p role="status" className="rounded-3xl border border-dashed border-line-strong/50 p-6 text-ink-muted">
            {copy.noMatch}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {shown.map((item, index) => {
              const body = (
                <>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -end-16 -top-16 h-44 w-44 rounded-full bg-[var(--tone-bg-strong)] opacity-40 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
                  />
                  <div className="relative flex items-start gap-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--tone-bg)] text-[var(--tone-ink)] ring-1 ring-[var(--tone-line)] transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6">
                      <AssistantIcon name={item.icon} className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <h2 className="font-display text-[1.05rem] font-semibold leading-snug text-ink">{item.name}</h2>
                      <p className="text-sm leading-relaxed text-ink-muted">{item.description}</p>
                    </div>
                  </div>
                  {item.ready ? (
                    <>
                      {item.uses.length > 0 ? (
                        <p className="relative flex flex-wrap gap-1.5">
                          <span className="sr-only">{copy.goodFor}: </span>
                          {item.uses.map((u) => (
                            <span key={u} className="rounded-full bg-[var(--tone-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--tone-ink)]">
                              {u}
                            </span>
                          ))}
                        </p>
                      ) : null}
                      {item.starters[0] ? (
                        <p className="relative truncate rounded-2xl border border-line bg-canvas/70 px-3 py-2 text-sm text-ink" dir="auto">
                          <span className="sr-only">{copy.tryAsking}: </span>“{item.starters[0]}”
                        </p>
                      ) : null}
                      <span className="relative mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--tone-ink)]">
                        {copy.startChat}
                        <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
                      </span>
                    </>
                  ) : (
                    <p className="relative text-sm text-ink-muted">
                      <span className="me-2 rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold">{copy.comingSoon}</span>
                      {copy.comingSoonBody}
                    </p>
                  )}
                </>
              );
              const cls =
                "tone group relative flex h-full flex-col gap-4 overflow-hidden rounded-[1.75rem] border border-line bg-surface p-5 shadow-soft";
              return (
                <li
                  key={item.id}
                  className="min-w-0 motion-safe:animate-[rise_500ms_var(--ease-out-soft)_both]"
                  style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
                >
                  {item.ready ? (
                    <Link
                      href={`/chat?assistant=${item.id}`}
                      onMouseEnter={() => setPreviewId(item.id)}
                      onFocus={() => setPreviewId(item.id)}
                      className={`${cls} lift hover:border-[var(--tone-line)] hover:shadow-lifted focus-visible:border-[var(--tone-line)]`}
                      style={toneStyle(item.hue, item.chroma)}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div aria-disabled="true" className={`${cls} border-dashed opacity-80`} style={toneStyle(item.hue, item.chroma)}>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {preview ? (
          <div className="sticky top-24 hidden lg:block" aria-live="polite">
            <div className="tone glass relative overflow-hidden rounded-[2rem] p-6 shadow-lifted" style={toneStyle(preview.hue, preview.chroma)}>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 transition-[background] duration-700"
                style={{ background: "radial-gradient(120% 70% at 50% 0%, var(--tone-bg-strong), transparent 60%)" }}
              />
              <div key={preview.id} className="relative space-y-5 motion-safe:animate-[fade-in_350ms_ease-out]">
                <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-surface text-[var(--tone-ink)] shadow-soft">
                  <AssistantIcon name={preview.icon} className="h-8 w-8" />
                </span>
                <div className="space-y-1.5">
                  <p className="font-display text-xl font-semibold leading-snug">{preview.name}</p>
                  <p className="text-sm leading-relaxed text-ink-muted">{preview.description}</p>
                </div>
                {preview.starters.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--tone-ink)]">{copy.tryAsking}</p>
                    <div className="space-y-2">
                      {preview.starters.map((s) => (
                        <p key={s} className="rounded-2xl bg-surface/80 px-3.5 py-2.5 text-sm text-ink shadow-soft" dir="auto">
                          “{s}”
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
                {preview.ready ? (
                  <Link
                    href={`/chat?assistant=${preview.id}`}
                    tabIndex={-1}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--tone-ink)] px-5 font-semibold text-surface transition-transform hover:-translate-y-0.5"
                  >
                    {copy.startChat}
                    <ArrowIcon />
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
