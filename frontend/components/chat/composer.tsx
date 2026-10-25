"use client";

import { type FormEvent, type KeyboardEvent, type RefObject, useLayoutEffect } from "react";

import { SendIcon } from "@/components/shell/icons";
import type { Messages } from "@/lib/i18n/messages";

const MAX_HEIGHT_PX = 220;

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
    <form onSubmit={submit} noValidate className="space-y-2">
      <label htmlFor="chat-message" className="sr-only">
        {t.inputLabel}
      </label>
      <div className="group relative">
        {/* Soft glow that follows focus (decorative). */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-[2rem] bg-gradient-to-r from-primary/30 via-primary/10 to-accent/30 opacity-0 blur-md transition-opacity duration-500 group-focus-within:opacity-100"
        />
        <div className="glass relative flex items-end gap-2 rounded-[1.75rem] p-2 shadow-lifted transition-colors group-focus-within:border-primary/60">
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
            className="scroll-quiet block max-h-[220px] min-h-12 w-full resize-none bg-transparent px-3.5 py-3 text-base leading-6 text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={pending || empty}
            aria-label={t.send}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary shadow-soft transition-all duration-300 hover:bg-primary-strong enabled:hover:scale-105 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted disabled:shadow-none"
          >
            {pending ? (
              <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <SendIcon />
            )}
          </button>
        </div>
      </div>
      <div className="flex items-start justify-between gap-3 px-3 text-xs text-ink-muted">
        <p id="chat-hint">{hint}</p>
        {remaining <= 60 ? (
          <p aria-live="polite" className={`shrink-0 tabular-nums ${remaining <= 10 ? "font-semibold text-warning-ink" : ""}`}>
            {t.charsLeft.replace("{n}", String(remaining))}
          </p>
        ) : null}
      </div>
    </form>
  );
}
