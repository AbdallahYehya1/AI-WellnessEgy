"use client";

import { useState } from "react";

import { Markdown } from "@/components/chat/markdown";
import type { Entry } from "@/components/chat/types";
import type { ChatCitation, ChatStatus } from "@/lib/api/backend";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

type ChatText = Messages["chat"];

// Source links only for HTTPS pages on the curated publishers' domains.
const LINKABLE_HOSTS = new Set([
  "www.who.int",
  "who.int",
  "www.nimh.nih.gov",
  "nimh.nih.gov",
  "www.nccih.nih.gov",
  "nccih.nih.gov",
  "www.cdc.gov",
  "cdc.gov",
]);

export function linkableSource(ref: string): string | null {
  try {
    const url = new URL(ref);
    return url.protocol === "https:" && LINKABLE_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Several passages often come from one document: list each source edition once. */
export function uniqueSources(citations: ChatCitation[]): ChatCitation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${c.source_ref}\u0000${c.version_label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const NOTICE_TONE: Record<ChatStatus, string> = {
  reply: "border-line bg-surface-muted text-ink",
  support: "border-info-ink/20 bg-info-bg text-info-ink",
  out_of_scope: "border-info-ink/20 bg-info-bg text-info-ink",
  no_evidence: "border-line bg-surface-muted text-ink",
  unable_to_answer: "border-warning-ink/20 bg-warning-bg text-warning-ink",
  unavailable: "border-warning-ink/20 bg-warning-bg text-warning-ink",
};

function timeLabel(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function sameQuestion(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[\s?.!؟،,]+$/u, "").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

export function MessageEntry({ entry, t, locale }: { entry: Entry; t: ChatText; locale: Locale }) {
  if (entry.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1 sm:max-w-[75%]">
          <div className="rounded-3xl rounded-ee-md bg-primary px-4 py-3 text-on-primary shadow-sm">
            <span className="sr-only">{t.you}: </span>
            <p className="whitespace-pre-wrap break-words leading-7" dir="auto">
              {entry.text}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-2 px-1 text-xs text-ink-muted">
            {entry.topic && !sameQuestion(entry.topic.question, entry.text) ? (
              <span dir="auto">
                {t.answeredAs} <span className="font-medium text-ink">{entry.topic.question}</span>
              </span>
            ) : null}
            <time dateTime={entry.createdAt}>{timeLabel(entry.createdAt, locale)}</time>
          </div>
        </div>
      </div>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <div className="flex gap-3">
        <div aria-hidden className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/40 text-primary-strong sm:flex">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <span className="sr-only">{t.assistant}: </span>
          <div className="text-[0.975rem] text-ink">
            <Markdown text={entry.text} />
          </div>
          <Citations citations={entry.citations} t={t} />
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <CopyButton text={entry.text} t={t} />
            <time dateTime={entry.createdAt}>{timeLabel(entry.createdAt, locale)}</time>
          </div>
        </div>
      </div>
    );
  }
  const body = entry.status === "out_of_scope" && entry.reason ? t.refusals[entry.reason] : entry.text;
  return (
    <div role="note" data-status={entry.status} className={`rounded-2xl border px-4 py-3 text-sm ${NOTICE_TONE[entry.status]}`}>
      <span className="sr-only">{t.assistantNotice}: </span>
      {entry.status !== "reply" ? <p className="font-semibold">{t.noticeTitles[entry.status]}</p> : null}
      <p className="mt-1 leading-6" dir="auto">
        {body}
      </p>
    </div>
  );
}

function CopyButton({ text, t }: { text: string; t: ChatText }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        {copied ? <path d="m5 12 5 5L20 7" /> : <path d="M9 9h10v10H9zM5 15V5h10" />}
      </svg>
      <span aria-live="polite">{copied ? t.copied : t.copy}</span>
    </button>
  );
}

export function Citations({ citations, t }: { citations: ChatCitation[]; t: ChatText }) {
  const sources = uniqueSources(citations);
  if (sources.length === 0) return null;
  return (
    <details className="group rounded-2xl border border-line bg-surface px-4 py-3 text-sm" open>
      <summary className="flex min-h-6 cursor-pointer list-none items-center gap-2 font-semibold text-ink">
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 text-primary transition-transform group-open:rotate-90 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 6 6 6-6 6" />
        </svg>
        {t.sources} ({sources.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {sources.map((c) => {
          const href = linkableSource(c.source_ref);
          return (
            <li key={c.chunk_id} className="space-y-0.5 border-t border-line pt-2 first:border-t-0 first:pt-0">
              {/* Source fields are rendered as text, never as HTML. */}
              <p className="font-medium text-ink" dir="auto">
                {c.source_title}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                <span dir="auto">{c.publisher}</span>
                <bdi dir="ltr">v{c.version_label}</bdi>
                {c.synthetic ? (
                  <span className="rounded bg-warning-bg px-1.5 font-semibold text-warning-ink">{t.synthetic}</span>
                ) : c.review_status === "draft" ? (
                  <span className="rounded bg-info-bg px-1.5 font-semibold text-info-ink">{t.draft}</span>
                ) : null}
              </p>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="block break-all text-xs text-primary-strong underline underline-offset-2"
                >
                  {c.source_ref}
                  <span className="sr-only"> ({t.openSource})</span>
                </a>
              ) : c.source_ref.startsWith("https://") ? (
                <span className="block break-all text-xs text-ink-muted" dir="ltr">
                  {c.source_ref}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
