"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";

import { buttonStyles } from "@/components/ui/primitives";
import type { ChatCitation, ChatStatus, ChatTurn } from "@/lib/api/backend";
import type { ChatActionResult, ChatErrorCode } from "@/lib/chat/actions";
import { MAX_HISTORY_TURNS, MAX_MESSAGE_CHARS } from "@/lib/chat/limits";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";

type Entry =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string; signature: string; citations: ChatCitation[] }
  | { id: number; kind: "notice"; status: ChatStatus; text: string };

export type DemoPrompt = { id: string; text: string; followUp: boolean };

type Props = {
  send: (message: string, history: ChatTurn[]) => Promise<ChatActionResult>;
  locale?: Locale;
  /** Restricted demo: the only questions the server accepts. No free-text box. */
  demoPrompts?: DemoPrompt[];
};

// Source links are shown only for HTTPS pages on the curated publishers' domains.
const LINKABLE_HOSTS = new Set(["www.who.int", "who.int", "www.nimh.nih.gov", "nimh.nih.gov"]);

function linkableSource(ref: string): string | null {
  try {
    const url = new URL(ref);
    return url.protocol === "https:" && LINKABLE_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Only user turns and server-signed assistant turns go back to the server. */
function historyFrom(entries: Entry[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const e of entries) {
    if (e.kind === "user") turns.push({ role: "user", text: e.text });
    else if (e.kind === "assistant") turns.push({ role: "assistant", text: e.text, signature: e.signature });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

const NOTICE_TONE: Record<ChatStatus, string> = {
  reply: "bg-surface-muted text-ink",
  support: "bg-info-bg text-info-ink",
  out_of_scope: "bg-info-bg text-info-ink",
  no_evidence: "bg-surface-muted text-ink",
  unable_to_answer: "bg-warning-bg text-warning-ink",
  unavailable: "bg-warning-bg text-warning-ink",
};

/**
 * The conversation lives only in this component's state: it is never written
 * to localStorage, sessionStorage, cookies or analytics, and it disappears on
 * refresh (D-37). Server notices are shown as the server wrote them.
 */
export function ChatClient({ send, locale = "en", demoPrompts }: Props) {
  const t = messages[locale].chat;
  const demo = (demoPrompts?.length ?? 0) > 0;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<{ message: string; code?: ChatErrorCode } | null>(null);
  const [pending, startTransition] = useTransition();
  const [nextId, setNextId] = useState(1);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);

  // Follow new messages only while the reader is at the bottom; otherwise
  // offer a "new message" button instead of yanking the scroll position.
  useEffect(() => {
    const el = logRef.current;
    if (!el || entries.length === 0) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [entries]);

  function onScroll() {
    const el = logRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current) setUnseen(false);
  }

  function jumpToLatest() {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setUnseen(false);
  }

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    sendMessage(draft.trim());
  }

  function sendMessage(message: string) {
    if (!message || pending) return;
    const history = historyFrom(entries);
    const userEntry: Entry = { id: nextId, kind: "user", text: message };
    setNextId((n) => n + 2);
    setError(null);
    atBottom.current = true;
    startTransition(async () => {
      const result = await send(message, history);
      if (result.kind === "error") {
        setError({ message: result.message, code: result.code });
        return; // the draft is kept so nothing the user typed is lost
      }
      const { response } = result;
      const answer: Entry =
        response.status === "reply" && response.reply
          ? {
              id: userEntry.id + 1,
              kind: "assistant",
              text: response.reply.text,
              signature: response.reply.signature,
              citations: response.reply.citations,
            }
          : { id: userEntry.id + 1, kind: "notice", status: response.status, text: response.notice ?? t.fallbackNotice };
      setEntries((current) => [...current, userEntry, answer]);
      setDraft("");
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a line. Never interrupt IME composition.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function applyStarter(text: string) {
    setDraft(text); // fills the box for review; it is not sent automatically
    inputRef.current?.focus();
  }

  function startOver() {
    setEntries([]);
    setError(null);
    setConfirmingReset(false);
    setUnseen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={logRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto py-4">
        {entries.length === 0 ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold">{t.welcomeTitle}</h2>
              <p className="text-sm text-ink-muted">{t.welcomeBody}</p>
            </div>
            {demo ? null : (
            <ul aria-label={t.startersLabel} className="grid gap-2 sm:grid-cols-2">
              {t.starters.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => applyStarter(starter)}
                    className="min-h-11 w-full rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-start text-sm hover:bg-surface-muted"
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
            )}
          </div>
        ) : null}

        <ol aria-label={t.conversationLabel} aria-live="polite" className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              {entry.kind === "user" ? (
                <div className="ms-10 rounded-2xl rounded-ee-md bg-primary px-4 py-3 text-sm text-on-primary">
                  <span className="sr-only">{t.you}: </span>
                  <p className="whitespace-pre-wrap" dir="auto">
                    {entry.text}
                  </p>
                </div>
              ) : entry.kind === "assistant" ? (
                <div className="me-10 space-y-2 rounded-2xl rounded-es-md border border-line bg-surface px-4 py-3 text-sm">
                  <span className="sr-only">{t.assistant}: </span>
                  <p className="whitespace-pre-wrap" dir="auto">
                    {entry.text}
                  </p>
                  <Citations
                    citations={entry.citations}
                    sourcesLabel={t.sources}
                    syntheticLabel={t.synthetic}
                    draftLabel={t.draft}
                    openLabel={t.openSource}
                  />
                </div>
              ) : (
                <div role="note" data-status={entry.status} className={`me-10 rounded-2xl px-4 py-3 text-sm ${NOTICE_TONE[entry.status]}`}>
                  <span className="sr-only">{t.assistantNotice}: </span>
                  {entry.status !== "reply" ? (
                    <p className="font-semibold">{t.noticeTitles[entry.status]}</p>
                  ) : null}
                  {/* Server-written notice text (English until translated server-side). */}
                  <p dir="auto">{entry.text}</p>
                </div>
              )}
            </li>
          ))}
        </ol>

        {pending ? (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden />
            {t.replying}
          </p>
        ) : null}
      </div>

      {unseen ? (
        <div className="flex justify-center">
          <button type="button" onClick={jumpToLatest} className={`${buttonStyles("secondary")} -mt-14 shadow`}>
            {t.newMessages}
          </button>
        </div>
      ) : null}

      <div className="space-y-2 border-t border-line bg-canvas pt-3">
        {error ? (
          <div className="space-y-2">
            <p role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-ink">
              {translateMessage(locale, error.message)}
            </p>
            {error.code === "invalid_history" ? (
              <button type="button" onClick={startOver} className={buttonStyles("secondary")}>
                {t.startOver}
              </button>
            ) : null}
          </div>
        ) : null}

        {demo ? (
          <DemoQuestions
            prompts={(demoPrompts ?? []).filter((p) => (entries.length === 0 ? !p.followUp : true))}
            label={entries.length === 0 ? t.demoStartersLabel : t.followUpsLabel}
            notice={t.demoNotice}
            disabled={pending}
            onAsk={sendMessage}
          />
        ) : (
        <form onSubmit={submit} className="space-y-2" noValidate>
          <label htmlFor="chat-message" className="text-sm font-semibold">
            {t.inputLabel}
          </label>
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              id="chat-message"
              name="message"
              dir="auto"
              rows={2}
              maxLength={MAX_MESSAGE_CHARS}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              aria-describedby="chat-hint"
              className="block max-h-40 min-h-12 w-full resize-y rounded-xl border border-line-strong bg-surface px-3 py-2 text-base text-ink"
            />
            <button type="submit" disabled={pending || !draft.trim()} className={buttonStyles("primary")}>
              {t.send}
            </button>
          </div>
          <p id="chat-hint" className="text-xs text-ink-muted">
            {t.inputHint}
          </p>
        </form>
        )}

        {entries.length > 0 ? (
          confirmingReset ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t.startOverConfirm}</span>
              <button type="button" onClick={startOver} disabled={pending} className={buttonStyles("secondary")}>
                {t.startOverYes}
              </button>
              <button type="button" onClick={() => setConfirmingReset(false)} className={buttonStyles("ghost")}>
                {t.cancel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              disabled={pending}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-strong underline underline-offset-4"
            >
              {t.startOver}
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

function DemoQuestions({
  prompts,
  label,
  notice,
  disabled,
  onAsk,
}: {
  prompts: DemoPrompt[];
  label: string;
  notice: string;
  disabled: boolean;
  onAsk: (text: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">{notice}</p>
      <ul aria-label={label} className="grid gap-2 sm:grid-cols-2">
        {prompts.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(p.text)}
              dir="auto"
              className="min-h-11 w-full rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-start text-sm hover:bg-surface-muted disabled:opacity-60"
            >
              {p.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Citations({
  citations,
  sourcesLabel,
  syntheticLabel,
  draftLabel,
  openLabel,
}: {
  citations: ChatCitation[];
  sourcesLabel: string;
  syntheticLabel: string;
  draftLabel: string;
  openLabel: string;
}) {
  if (citations.length === 0) return null;
  return (
    <details className="border-t border-line pt-2 text-xs text-ink-muted" open>
      <summary className="min-h-6 cursor-pointer font-semibold">
        {sourcesLabel} ({citations.length})
      </summary>
      <ul className="mt-1 space-y-1">
        {citations.map((c) => (
          <li key={c.chunk_id} dir="auto">
            {/* Source fields are rendered as text, never as HTML or links. */}
            {c.source_title} · {c.publisher} · v{c.version_label}
            {c.synthetic ? (
              <span className="ms-1 rounded bg-warning-bg px-1.5 font-semibold text-warning-ink">{syntheticLabel}</span>
            ) : c.review_status === "draft" ? (
              <span className="ms-1 rounded bg-info-bg px-1.5 font-semibold text-info-ink">{draftLabel}</span>
            ) : null}
            {linkableSource(c.source_ref) ? (
              <a
                href={linkableSource(c.source_ref) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="block break-all text-primary-strong underline underline-offset-2"
              >
                {c.source_ref}
                <span className="sr-only"> ({openLabel})</span>
              </a>
            ) : c.source_ref.startsWith("https://") ? (
              <span className="block break-all text-ink-muted" dir="ltr">
                {c.source_ref}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
