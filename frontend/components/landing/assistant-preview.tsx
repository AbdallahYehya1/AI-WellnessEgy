"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { AssistantIcon } from "@/components/assistants/icons";
import { toneStyle } from "@/components/ui/primitives";
import type { CatalogEntry } from "@/lib/assistants/catalog";
import type { Locale } from "@/lib/i18n/config";

type Copy = { label: string; ask: string; answer: string; sources: string; illustrative: string };

const ROTATE_MS = 4200;

/**
 * Hero preview of the ten assistants: a tablist (arrow keys, Home/End) with a panel that
 * shows the chosen assistant and one of its real conversation starters. The answer area is
 * deliberately a placeholder, labelled as illustrative: no fabricated AI output. It rotates
 * on its own until someone interacts, and never under reduced motion.
 */
export function AssistantPreview({ assistants, locale, copy }: { assistants: readonly CatalogEntry[]; locale: Locale; copy: Copy }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (paused || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % assistants.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, assistants.length]);

  function choose(i: number, focus = false) {
    setPaused(true);
    setIndex(i);
    if (focus) tabs.current[i]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = document.documentElement.dir === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    const n = assistants.length;
    const keys: Record<string, number> = {
      [forward]: (index + 1) % n,
      [back]: (index - 1 + n) % n,
      ArrowDown: (index + 1) % n,
      ArrowUp: (index - 1 + n) % n,
      Home: 0,
      End: n - 1,
    };
    if (event.key in keys) {
      event.preventDefault();
      choose(keys[event.key]!, true);
    }
  }

  const active = assistants[index]!;
  return (
    <div
      className="tone glass relative w-full overflow-hidden rounded-[2rem] p-3 shadow-lifted sm:p-4"
      style={toneStyle(active.hue, active.chroma)}
      onMouseEnter={() => setPaused(true)}
      onFocus={() => setPaused(true)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-[2rem] opacity-70 transition-[background] duration-700"
        style={{ background: "radial-gradient(120% 80% at 100% 0%, var(--tone-bg-strong), transparent 55%)" }}
      />
      <div role="tablist" aria-label={copy.label} onKeyDown={onKeyDown} className="relative grid grid-cols-5 gap-1.5 sm:gap-2">
        {assistants.map((a, i) => (
          <button
            key={a.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`preview-tab-${a.id}`}
            aria-selected={i === index}
            aria-controls="preview-panel"
            tabIndex={i === index ? 0 : -1}
            aria-label={a.name[locale]}
            title={a.name[locale]}
            onClick={() => choose(i)}
            className="tone flex aspect-square items-center justify-center rounded-2xl border border-transparent bg-[var(--tone-bg)] text-[var(--tone-ink)] transition-all duration-300 hover:-translate-y-0.5 aria-selected:scale-[1.04] aria-selected:border-[var(--tone-line)] aria-selected:shadow-soft"
            style={toneStyle(a.hue, a.chroma)}
          >
            <AssistantIcon name={a.icon} className="h-6 w-6 sm:h-7 sm:w-7" />
          </button>
        ))}
      </div>

      <div
        id="preview-panel"
        role="tabpanel"
        aria-labelledby={`preview-tab-${active.id}`}
        className="relative mt-3 rounded-[1.5rem] border border-line/80 bg-surface/90 p-4 sm:mt-4 sm:p-5"
      >
        <div key={active.id} className="space-y-4 motion-safe:animate-[fade-in_400ms_ease-out]">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--tone-bg)] text-[var(--tone-ink)]">
              <AssistantIcon name={active.icon} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-display truncate font-semibold">{active.name[locale]}</p>
              <p className="truncate text-xs text-ink-muted">{active.uses[locale].join(" · ")}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-ee-md bg-primary px-4 py-2.5 text-sm text-on-primary" dir="auto">
              <span className="sr-only">{copy.ask}: </span>
              {active.starter[locale]}
            </p>
          </div>
          <div className="space-y-2.5 rounded-2xl bg-surface-muted/80 p-4">
            <p className="text-sm text-ink-muted">{copy.answer}</p>
            <div aria-hidden className="space-y-1.5">
              <span className="block h-2 w-11/12 rounded-full bg-[var(--tone-bg-strong)]" />
              <span className="block h-2 w-9/12 rounded-full bg-[var(--tone-bg-strong)] opacity-80" />
              <span className="block h-2 w-10/12 rounded-full bg-[var(--tone-bg-strong)] opacity-60" />
            </div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-[var(--tone-line)] bg-surface px-2.5 py-1 text-xs font-semibold text-[var(--tone-ink)]">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--tone-solid)]" />
              {copy.sources}
            </p>
          </div>
        </div>
      </div>
      <p className="relative mt-3 px-1 text-center text-xs text-ink-muted">{copy.illustrative}</p>
    </div>
  );
}
