"use client";

import Link from "next/link";
import { useState } from "react";

import { AssistantIcon } from "@/components/assistants/icons";
import { ArrowIcon } from "@/components/shell/icons";
import { toneStyle } from "@/components/ui/primitives";
import type { AssistantGroup, CatalogEntry } from "@/lib/assistants/catalog";
import type { Locale } from "@/lib/i18n/config";

type Filter = "all" | AssistantGroup;

/** Public assistant explorer: filter chips (a radio group) and ten tone-coloured tiles.
 * Each tile opens that assistant (signing in first when needed). */
export function AssistantExplorer({
  assistants,
  locale,
  groups,
  filterLabel,
}: {
  assistants: readonly CatalogEntry[];
  locale: Locale;
  groups: Record<Filter, string>;
  filterLabel: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = assistants.filter((a) => filter === "all" || a.group === filter);
  const order: Filter[] = ["all", "people", "work", "mind", "everyday"];
  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label={filterLabel} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scroll-quiet">
        {order.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className="min-h-10 shrink-0 rounded-full border border-line bg-surface/70 px-4 text-sm font-semibold text-ink-muted transition-all duration-200 hover:text-ink aria-checked:border-transparent aria-checked:bg-ink aria-checked:text-canvas"
          >
            {groups[f]}
          </button>
        ))}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {shown.map((a) => (
          <li key={a.id} className="min-w-0 motion-safe:animate-[fade-in_300ms_ease-out]">
            <Link
              href={`/chat?assistant=${a.id}`}
              className="tone lift group relative flex h-full flex-col gap-4 overflow-hidden rounded-3xl border border-line bg-surface p-5 shadow-soft hover:border-[var(--tone-line)] hover:shadow-lifted"
              style={toneStyle(a.hue, a.chroma)}
            >
              <span
                aria-hidden
                className="absolute -end-10 -top-10 h-32 w-32 rounded-full bg-[var(--tone-bg-strong)] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
              />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--tone-bg)] text-[var(--tone-ink)] transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6">
                <AssistantIcon name={a.icon} className="h-6 w-6" />
              </span>
              <span className="relative space-y-1.5">
                <span className="font-display block font-semibold leading-snug text-ink">{a.name[locale]}</span>
                <span className="block text-sm leading-relaxed text-ink-muted">{a.description[locale]}</span>
              </span>
              <span className="relative mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--tone-ink)]">
                {a.uses[locale][0]} · {a.uses[locale][1]}
                <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
