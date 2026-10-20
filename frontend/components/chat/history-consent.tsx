"use client";

import { type KeyboardEvent, useEffect, useRef } from "react";

import type { Messages } from "@/lib/i18n/messages";

type Props = {
  t: Messages["chat"];
  retentionDays: number;
  busy: boolean;
  error: string | null;
  onAgree: () => void;
  onDecline: () => void;
};

/** Explicit, informed opt-in before anything is saved (D-54). Declining keeps chats browser-only. */
export function HistoryConsent({ t, retentionDays, busy, error, onAgree, onDecline }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    declineRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onDecline();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onKeyDown={onKeyDown}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-consent-title"
        className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl bg-surface p-6 shadow-xl"
      >
        <h2 id="history-consent-title" className="text-lg font-bold text-ink">
          {t.consentTitle}
        </h2>
        <ul className="list-disc space-y-2 ps-5 text-sm leading-6 text-ink">
          {t.consentPoints.map((point) => (
            <li key={point}>{point.replace("{days}", String(retentionDays))}</li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-ink">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={declineRef}
            type="button"
            onClick={onDecline}
            className="min-h-11 rounded-xl border border-line-strong px-4 text-sm font-semibold text-ink hover:bg-surface-muted"
          >
            {t.consentDecline}
          </button>
          <button
            type="button"
            onClick={onAgree}
            disabled={busy}
            className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-strong disabled:opacity-50"
          >
            {t.consentAgree}
          </button>
        </div>
      </div>
    </div>
  );
}
