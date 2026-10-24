"use client";

import { type FormEvent, type KeyboardEvent, type RefObject, useLayoutEffect } from "react";

import type { Messages } from "@/lib/i18n/messages";

const MAX_HEIGHT_PX = 200;

type Props = {
  t: Messages["chat"];
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  pending: boolean;
  maxLength: number;
  hint: string;
  /** Overrides the default wellbeing placeholder (specialised assistants). */
  placeholder?: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

/**
 * Multiline composer: Enter sends, Shift+Enter adds a line, IME composition is never
 * interrupted, and the box grows with its content up to a maximum. While it has focus
 * on a phone the bottom tab bar is hidden, so the box stays directly above the keyboard.
 */
export function Composer({ t, value, onChange, onSend, pending, maxLength, hint, placeholder, inputRef }: Props) {
  const remaining = maxLength - value.length;
  const empty = !value.trim();

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value, inputRef]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!empty && !pending) onSend();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function setComposing(on: boolean) {
    if (on) document.documentElement.dataset.chatComposing = "true";
    else delete document.documentElement.dataset.chatComposing;
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-1.5">
      <label htmlFor="chat-message" className="sr-only">
        {t.inputLabel}
      </label>
      <div className="flex items-end gap-2 rounded-3xl border border-line-strong bg-surface p-2 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-focus">
        <textarea
          ref={inputRef}
          id="chat-message"
          name="message"
          dir="auto"
          rows={1}
          maxLength={maxLength}
          value={value}
          placeholder={placeholder ?? t.inputPlaceholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setComposing(true)}
          onBlur={() => setComposing(false)}
          aria-describedby="chat-hint"
          enterKeyHint="send"
          className="block max-h-[200px] min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-base leading-6 text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={pending || empty}
          aria-label={t.send}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition-opacity hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? (
            <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-on-primary border-t-transparent" />
          ) : (
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </div>
      <div className="flex items-start justify-between gap-3 px-2 text-xs text-ink-muted">
        <p id="chat-hint">{hint}</p>
        {remaining <= 60 ? (
          <p aria-live="polite" className={`shrink-0 ${remaining <= 10 ? "font-semibold text-warning-ink" : ""}`}>
            {t.charsLeft.replace("{n}", String(remaining))}
          </p>
        ) : null}
      </div>
    </form>
  );
}
