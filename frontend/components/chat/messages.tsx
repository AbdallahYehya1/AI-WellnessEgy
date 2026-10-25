"use client";

import { useState } from "react";

import { AssistantIcon } from "@/components/assistants/icons";
import { Markdown } from "@/components/chat/markdown";
import { CheckIcon, CopyIcon } from "@/components/shell/icons";
import type { Entry } from "@/components/chat/types";
import type { ChatCitation, ChatStatus } from "@/lib/api/backend";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";

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
  // Publishers added with the ten assistants (D-61), each licence-checked.
  "odphp.health.gov",
  "medlineplus.gov",
  "womenshealth.gov",
  "www.niddk.nih.gov",
  "www.opm.gov",
  "www.consumerfinance.gov",
  "www.mymoney.gov",
  "www.ready.gov",
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
  clarify: "border-line bg-surface-muted text-ink",
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

/** One chat entry. `icon`: the active assistant's icon for the reply avatar (it takes the
 * surrounding `.tone`). */
export function MessageEntry({ entry, t, locale, icon = "leaf" }: { entry: Entry; t: ChatText; locale: Locale; icon?: string }) {
  if (entry.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1 sm:max-w-[75%]">
          <div className="rounded-[1.4rem] rounded-ee-md bg-gradient-to-br from-primary to-primary-strong px-4 py-3 text-on-primary shadow-soft">
            <span className="sr-only">{t.you}: </span>
            <p className="whitespace-pre-wrap break-words leading-7" dir="auto">
              {entry.text}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-2 px-1 text-xs text-ink-muted">
            {entry.shared ? (
              <span dir="auto" className="basis-full text-end">
                {t.sharedWithAi} <span className="font-medium text-ink">{entry.shared}</span>
              </span>
            ) : null}
            {!entry.shared && entry.topic && !sameQuestion(entry.topic.question, entry.text) ? (
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
        <div aria-hidden className="mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--tone-bg,var(--surface-muted))] text-[var(--tone-ink,var(--primary-strong))] ring-1 ring-[var(--tone-line,var(--line))] sm:flex">
          <AssistantIcon name={icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <span className="sr-only">{t.assistant}: </span>
          <div className="text-[0.99rem] leading-7 text-ink">
            <Markdown text={entry.text} />
          </div>
          {entry.citations.length > 0 ? (
            <Citations citations={entry.citations} t={t} />
          ) : (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 text-xs text-ink-muted">{t.generalGuidance}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <CopyButton text={entry.text} t={t} />
            <time dateTime={entry.createdAt}>{timeLabel(entry.createdAt, locale)}</time>
          </div>
        </div>
      </div>
    );
  }
  const body =
    entry.status === "out_of_scope" && entry.reason
      ? t.refusals[entry.reason]
      : entry.status === "clarify"
        ? t.clarify
        : entry.supportKind
        ? t.support[entry.supportKind]
        : entry.reason === "daily_limit" || entry.reason === "shared_limit"
          ? t.refusals[entry.reason]
          : translateMessage(locale, entry.text);
  return (
    <div role="note" data-status={entry.status} className={`rounded-3xl border px-5 py-4 text-sm shadow-soft ${NOTICE_TONE[entry.status]}`}>
      <span className="sr-only">{t.assistantNotice}: </span>
      {entry.status !== "reply" ? <p className="font-semibold">{t.noticeTitles[entry.status]}</p> : null}
      <p className="mt-1 leading-6" dir="auto">
        {body}
      </p>
      {entry.resources && entry.resources.length > 0 ? (
        <div className="mt-3">
          <Citations citations={entry.resources} t={t} />
        </div>
      ) : null}
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
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
    >
      {copied ? <CheckIcon className="h-4 w-4 text-success-ink" /> : <CopyIcon className="h-4 w-4" />}
      <span aria-live="polite">{copied ? t.copied : t.copy}</span>
    </button>
  );
}

function hostOf(ref: string): string {
  try {
    return new URL(ref).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Sources of one reply, as numbered cards: exact title, publisher and edition, and a
 * link only to the curated publishers' HTTPS pages. Rendered as text, never as HTML. */
export function Citations({ citations, t }: { citations: ChatCitation[]; t: ChatText }) {
  const sources = uniqueSources(citations);
  if (sources.length === 0) return null;
  return (
    <details className="group/src rounded-3xl border border-line bg-surface/80 p-1 text-sm shadow-soft" open>
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-[1.25rem] px-3 font-semibold text-ink transition-colors hover:bg-surface-muted">
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 text-primary transition-transform group-open/src:rotate-90 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 6 6 6-6 6" />
        </svg>
        {t.sources} ({sources.length})
      </summary>
      <ol className="grid gap-1.5 p-2 pt-1 sm:grid-cols-2">
        {sources.map((c, i) => {
          const href = linkableSource(c.source_ref);
          const host = hostOf(c.source_ref);
          return (
            <li key={c.chunk_id} className="flex min-w-0 gap-3 rounded-2xl bg-canvas/70 p-3">
              <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-xs font-bold text-primary-strong">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium leading-snug text-ink" dir="auto">
                  {c.source_title}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                  <span dir="auto">{c.publisher}</span>
                  <bdi dir="ltr">{/^\d/.test(c.version_label) ? `v${c.version_label}` : c.version_label}</bdi>
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
                    title={c.source_ref}
                    className="inline-flex min-h-6 max-w-full items-center gap-1 truncate text-xs font-semibold text-primary-strong underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                  >
                    <span className="truncate">{host || c.source_ref}</span>
                    <span aria-hidden>↗</span>
                    <span className="sr-only"> ({t.openSource})</span>
                  </a>
                ) : c.source_ref.startsWith("https://") ? (
                  <span className="block truncate text-xs text-ink-muted" dir="ltr" title={c.source_ref}>
                    {c.source_ref}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
