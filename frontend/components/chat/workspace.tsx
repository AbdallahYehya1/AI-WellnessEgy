"use client";

import { type KeyboardEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { Composer } from "@/components/chat/composer";
import { ConsentDialog } from "@/components/chat/consent-dialog";
import { HistoryConsent } from "@/components/chat/history-consent";
import { AssistantIcon } from "@/components/assistants/icons";
import { MessageEntry } from "@/components/chat/messages";
import { Sidebar } from "@/components/chat/sidebar";
import type { Entry, Suggestion } from "@/components/chat/types";
import type {
  ChatResponse,
  ChatTurn,
  ConversationDetail,
  ConversationPage,
  ContextSettings,
  ConversationSummary,
  HistorySettings,
  StoredMessage,
  SupportedTopic,
} from "@/lib/api/backend";
import type { ActionResult, ChatActionResult, ChatErrorCode, SendInput } from "@/lib/chat/actions";
import { MAX_HISTORY_TURNS, MAX_MESSAGE_CHARS, MAX_TOPIC_CHARS } from "@/lib/chat/limits";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";

export type ChatActions = {
  send: (input: SendInput) => Promise<ChatActionResult>;
  loadConversations: (cursor?: string, query?: string, assistant?: string) => Promise<ActionResult<ConversationPage>>;
  openConversation: (id: string, before?: number) => Promise<ActionResult<ConversationDetail>>;
  renameChat: (id: string, title: string) => Promise<ActionResult<ConversationSummary>>;
  deleteChat: (id: string) => Promise<ActionResult<null>>;
  deleteAllChats: () => Promise<ActionResult<null>>;
  setHistoryEnabled: (enabled: boolean, consentVersion?: string) => Promise<ActionResult<HistorySettings>>;
  setContextEnabled?: (enabled: boolean, consentVersion?: string) => Promise<ActionResult<ContextSettings>>;
};

/** sessionStorage key for a draft started from a Daily Reflection (offered, never sent). */
export const DRAFT_KEY = "aiwe.chatDraft";

const subscribeNothing = () => () => {};

function storedDraft(assistantId: string | undefined): string | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { assistant?: string; text?: string };
    return typeof saved.text === "string" && saved.assistant === assistantId ? saved.text.slice(0, MAX_MESSAGE_CHARS) : null;
  } catch {
    return null; // storage blocked or malformed
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // nothing to clear
  }
}

export type CurrentAssistant = { id: string; name: string; description: string; icon: string };

type Props = {
  actions: ChatActions;
  /** The specialised assistant this workspace talks to (null: the default wellbeing chat). */
  assistant?: CurrentAssistant | null;
  /** Ready assistants' display names, for handoff suggestions. */
  assistantNames?: Record<string, string>;
  /** Show the wellbeing topic list on the empty screen (default assistant only). */
  showTopics?: boolean;
  locale?: Locale;
  suggestions: Suggestion[];
  topics: SupportedTopic[];
  typedInput: "topics" | "free";
  modeNote: string | null;
  /** The note shown instead once the user shares context with the provider. */
  modeNoteShared?: string | null;
  history: HistorySettings | null;
  initialConversations?: ConversationPage | null;
  /** Provider context (D-59): offered only when the server allows it; off until opted in. */
  context?: ContextSettings | null;
};

type FailedSend = { text: string; clientMessageId: string; message: string; code?: ChatErrorCode };

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.floor(Math.random() * 256) & (15 >> (Number(c) / 4)))).toString(16),
  );
}

function fromStored(message: StoredMessage): Entry {
  return message.role === "user"
    ? { id: message.message_id, kind: "user", text: message.text, topic: message.topic, createdAt: message.created_at }
    : {
        id: message.message_id,
        kind: "assistant",
        text: message.text,
        signature: message.signature ?? "",
        citations: message.citations,
        createdAt: message.created_at,
      };
}

/** Browser-held context for unsaved chats: answered questions and server-signed replies only. */
function historyFrom(entries: Entry[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  entries.forEach((entry, i) => {
    const next = entries[i + 1];
    if (entry.kind === "user" && next?.kind === "assistant") turns.push({ role: "user", text: entry.text });
    else if (entry.kind === "assistant" && entry.signature) turns.push({ role: "assistant", text: entry.text, signature: entry.signature });
  });
  return turns.slice(-MAX_HISTORY_TURNS);
}

export function ChatWorkspace({
  actions,
  assistant = null,
  assistantNames = {},
  showTopics = true,
  locale = "en",
  suggestions,
  topics,
  typedInput,
  modeNote,
  history: initialHistory,
  initialConversations,
  context: initialContext = null,
  modeNoteShared,
}: Props) {
  const t = messages[locale].chat;
  const at = messages[locale].assistants;
  const assistantId = assistant?.id;
  const [history, setHistory] = useState<HistorySettings | null>(initialHistory);
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations?.conversations ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialConversations?.next_cursor ?? null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ConversationSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<FailedSend | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startSend] = useTransition();
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [context, setContext] = useState<ContextSettings | null>(initialContext);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const sending = useRef(false);

  // A draft started from a Daily Reflection is offered, and only used if the person chooses it.
  const reflectionDraft = useSyncExternalStore(subscribeNothing, () => storedDraft(assistantId), () => null);
  const [draftHandled, setDraftHandled] = useState(false);
  const offeredDraft = draftHandled ? null : reflectionDraft;

  const saving = !!history?.available && history.enabled;
  const maxLength = typedInput === "topics" ? MAX_TOPIC_CHARS : MAX_MESSAGE_CHARS;
  const active = conversations.find((c) => c.conversation_id === activeId) ?? null;
  const savedNow = saving && activeId !== null;
  const answered = entries.some((e) => e.kind === "assistant");
  const visibleSuggestions = suggestions.filter((s) => (answered ? s.followUp : !s.followUp));

  // Follow new messages only while the reader is at the bottom.
  useEffect(() => {
    const el = logRef.current;
    if (!el || entries.length === 0) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [entries, pending]);

  useEffect(
    () => () => {
      delete document.documentElement.dataset.chatComposing;
    },
    [],
  );

  // Server-side title search, debounced.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(async () => {
      const result = await actions.loadConversations(undefined, q, assistantId);
      setSearchResults(result.ok ? result.data.conversations : []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, actions, assistantId]);

  // Mobile drawer: focus moves in, Escape closes.
  useEffect(() => {
    if (drawerOpen) drawerRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [drawerOpen]);

  function changeQuery(value: string) {
    setQuery(value);
    const searchingNow = value.trim() !== "";
    setSearching(searchingNow);
    if (!searchingNow) setSearchResults(null);
  }

  function onScroll() {
    const el = logRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (atBottom.current) setUnseen(false);
  }

  function jumpToLatest() {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    atBottom.current = true;
    setUnseen(false);
  }

  const focusComposer = useCallback(() => {
    // On phones, don't pop the keyboard open uninvited.
    if (window.matchMedia?.("(min-width: 1024px)").matches) inputRef.current?.focus();
  }, []);

  function upsertConversation(summary: ConversationSummary) {
    setConversations((list) => [summary, ...list.filter((c) => c.conversation_id !== summary.conversation_id)]);
  }

  function applyResponse(userEntryId: string, response: ChatResponse) {
    const now = new Date().toISOString();
    const answer: Entry =
      response.status === "reply" && response.reply
        ? {
            id: response.assistant_message_id ?? newId(),
            kind: "assistant",
            text: response.reply.text,
            signature: response.reply.signature,
            citations: response.reply.citations,
            createdAt: response.created_at ?? now,
          }
        : {
            id: newId(),
            kind: "notice",
            status: response.status,
            reason: response.refusal_reason ?? null,
            text: response.notice ?? t.fallbackNotice,
            createdAt: now,
            handoff: response.handoff && assistantNames[response.handoff] ? response.handoff : null,
            supportKind: response.status === "support" ? (response.support_kind ?? null) : null,
            resources: response.resources ?? [],
          };
    setEntries((current) => [
            ...current.map((e) =>
        e.id === userEntryId && e.kind === "user"
          ? { ...e, topic: response.topic ?? null, shared: response.provider_context ?? null }
          : e,
      ),
      answer,
    ]);
    if (response.conversation) {
      upsertConversation(response.conversation);
      setActiveId(response.conversation.conversation_id);
    }
  }

  function send(text: string, retryId?: string) {
    const message = text.trim();
    if (!message || sending.current) return; // never two sends at once
    sending.current = true;
    const clientMessageId = retryId ?? newId();
    const userEntry: Entry = { id: `local-${clientMessageId}`, kind: "user", text: message, topic: null, createdAt: new Date().toISOString() };
    const continueSaved = saving && activeId !== null;
    const input: SendInput = {
      message,
      clientMessageId,
      assistantId,
      conversationId: continueSaved ? activeId : undefined,
      history: continueSaved ? [] : historyFrom(entries),
    };
    setFailed(null);
    setNotice(null);
    setDraft("");
    atBottom.current = true;
    setEntries((current) => [...current, userEntry]);
    startSend(async () => {
      try {
        const result = await actions.send(input);
        if (result.kind === "error") {
          setEntries((current) => current.filter((e) => e.id !== userEntry.id));
          setDraft(message); // nothing typed is lost
          setFailed({ text: message, clientMessageId, message: result.message, code: result.code });
          return;
        }
        applyResponse(userEntry.id, result.response);
      } finally {
        sending.current = false;
      }
    });
  }

  function newChat() {
    setActiveId(null);
    setEntries([]);
    setNextBefore(null);
    setFailed(null);
    setNotice(null);
    setDraft("");
    setDrawerOpen(false);
    focusComposer();
  }

  async function open(id: string) {
    if (pending) return;
    setDrawerOpen(false);
    setLoadingConversation(true);
    setFailed(null);
    setNotice(null);
    const result = await actions.openConversation(id);
    setLoadingConversation(false);
    if (!result.ok) {
      if (result.code === "not_found") setConversations((list) => list.filter((c) => c.conversation_id !== id));
      setNotice(translateMessage(locale, result.message));
      return;
    }
    setActiveId(id);
    setEntries(result.data.messages.map(fromStored));
    setNextBefore(result.data.next_before);
    atBottom.current = true;
    focusComposer();
  }

  async function loadOlder() {
    if (!activeId || nextBefore === null) return;
    const el = logRef.current;
    const previousHeight = el?.scrollHeight ?? 0;
    const result = await actions.openConversation(activeId, nextBefore);
    if (!result.ok) return;
    atBottom.current = false;
    setEntries((current) => [...result.data.messages.map(fromStored), ...current]);
    setNextBefore(result.data.next_before);
    // Keep the reader's place instead of jumping.
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - previousHeight;
    });
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const result = await actions.loadConversations(nextCursor, undefined, assistantId);
    setLoadingMore(false);
    if (!result.ok) return;
    setConversations((list) => [...list, ...result.data.conversations.filter((c) => !list.some((x) => x.conversation_id === c.conversation_id))]);
    setNextCursor(result.data.next_cursor);
  }

  async function rename(id: string, title: string): Promise<boolean> {
    setBusy(true);
    const result = await actions.renameChat(id, title);
    setBusy(false);
    if (!result.ok) {
      setNotice(translateMessage(locale, result.message));
      return false;
    }
    setConversations((list) => list.map((c) => (c.conversation_id === id ? result.data : c)));
    setSearchResults((list) => list?.map((c) => (c.conversation_id === id ? result.data : c)) ?? null);
    return true;
  }

  async function remove(id: string) {
    setBusy(true);
    const result = await actions.deleteChat(id);
    setBusy(false);
    if (!result.ok) {
      setNotice(translateMessage(locale, result.message));
      return;
    }
    setConversations((list) => list.filter((c) => c.conversation_id !== id));
    setSearchResults((list) => list?.filter((c) => c.conversation_id !== id) ?? null);
    if (id === activeId) newChat();
  }

  async function removeAll() {
    setBusy(true);
    const result = await actions.deleteAllChats();
    setBusy(false);
    if (!result.ok) {
      setNotice(translateMessage(locale, result.message));
      return;
    }
    setConversations([]);
    setSearchResults(null);
    setNextCursor(null);
    setQuery("");
    if (activeId) newChat();
  }

  async function turnOn() {
    if (!history) return;
    setBusy(true);
    setConsentError(null);
    const result = await actions.setHistoryEnabled(true, history.consent_version);
    setBusy(false);
    if (!result.ok) {
      setConsentError(translateMessage(locale, result.message));
      return;
    }
    setHistory(result.data);
    setConsentOpen(false);
    const list = await actions.loadConversations(undefined, undefined, assistantId);
    if (list.ok) {
      setConversations(list.data.conversations);
      setNextCursor(list.data.next_cursor);
    }
  }

  async function shareContext(enabled: boolean) {
    if (!context || !actions.setContextEnabled) return;
    setBusy(true);
    setContextError(null);
    const result = await actions.setContextEnabled(enabled, enabled ? context.consent_version : undefined);
    setBusy(false);
    if (!result.ok) {
      if (enabled) setContextError(translateMessage(locale, result.message));
      else setNotice(translateMessage(locale, result.message));
      return;
    }
    setContext(result.data);
    setContextOpen(false);
    focusComposer();
  }

  async function turnOff() {
    setBusy(true);
    const result = await actions.setHistoryEnabled(false);
    setBusy(false);
    if (!result.ok) {
      setNotice(translateMessage(locale, result.message));
      return;
    }
    setHistory(result.data);
    // An open saved chat can still continue, unsaved, from its signed replies.
    setActiveId(null);
  }

  function onDrawerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") setDrawerOpen(false);
  }

  const listed = searchResults ?? conversations;
  const sidebar = (mobile: boolean) => (
    <Sidebar
      t={t}
      locale={locale}
      history={history}
      conversations={listed}
      activeId={activeId}
      query={query}
      onQuery={changeQuery}
      searching={searching}
      hasMore={!!nextCursor}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
      onNewChat={newChat}
      onOpen={open}
      onRename={rename}
      onDelete={remove}
      onTurnOn={() => setConsentOpen(true)}
      onTurnOff={turnOff}
      onDeleteAll={removeAll}
      onCollapse={mobile ? undefined : () => setCollapsed(true)}
      onClose={mobile ? () => setDrawerOpen(false) : undefined}
      busy={busy}
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Desktop sidebar */}
      {!collapsed ? (
        <aside aria-label={t.chats} className="hidden w-72 shrink-0 border-e border-line bg-surface lg:flex lg:flex-col">
          {sidebar(false)}
        </aside>
      ) : null}

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" onKeyDown={onDrawerKeyDown}>
          <button type="button" aria-label={t.closeChats} className="absolute inset-0 bg-ink/40" onClick={() => setDrawerOpen(false)} />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t.chats}
            className="absolute inset-y-0 start-0 flex w-[85%] max-w-xs flex-col bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-xl"
          >
            {sidebar(true)}
          </div>
        </div>
      ) : null}

      <section aria-label={t.conversationLabel} className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 items-center gap-2 border-b border-line px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={t.openChats}
            aria-expanded={drawerOpen}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted lg:hidden"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label={t.showSidebar}
              title={t.showSidebar}
              className="hidden h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted lg:inline-flex"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <path d="M9 4v16M13 10l2 2-2 2" />
              </svg>
            </button>
          ) : null}
          {assistant ? (
            <span aria-hidden className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary/40 text-primary-strong sm:flex">
              <AssistantIcon name={assistant.icon} className="h-5 w-5" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-ink" dir="auto">
              {active?.title ?? (entries.length > 0 && !saving ? (assistant?.name ?? t.title) : t.newChat)}
            </h1>
            {assistant ? (
              <p className="truncate text-xs text-ink-muted" dir="auto">
                {assistant.name}
              </p>
            ) : null}
          </div>
          <a href="/assistants" className="hidden shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-primary-strong underline-offset-4 hover:underline sm:inline">
            {at.all}
          </a>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${savedNow ? "bg-success-bg text-success-ink" : "bg-surface-muted text-ink-muted"}`}>
            {savedNow ? t.savedBadge : t.notSavedBadge}
          </span>
          <span className="hidden shrink-0 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning-ink sm:inline">
            {t.prototype}
          </span>
        </header>

        <div ref={logRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            {loadingConversation ? (
              <p role="status" className="py-10 text-center text-sm text-ink-muted">
                {t.loading}
              </p>
            ) : entries.length === 0 ? (
              <div className="space-y-6 py-4 sm:py-10">
                <div className="space-y-2 text-center">
                  {assistant ? (
                    <span aria-hidden className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-secondary/40 text-primary-strong">
                      <AssistantIcon name={assistant.icon} className="h-7 w-7" />
                    </span>
                  ) : null}
                  <h2 className="text-2xl font-bold text-ink">{assistant && !showTopics ? assistant.name : t.welcomeTitle}</h2>
                  <p className="text-ink-muted">{assistant && !showTopics ? assistant.description : t.welcomeBody}</p>
                </div>
                {showTopics ? (
                <div className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-ink">{t.topicsTitle}</h3>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {topics.map((topic) => (
                      <li key={topic.prompt_id} className="rounded-full bg-secondary/30 px-3 py-1 text-sm text-ink">
                        {t.topicNames[topic.prompt_id as keyof typeof t.topicNames] ?? (locale === "ar" ? topic.ar : topic.en)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-ink-muted">{t.cannotDo}</p>
                </div>
                ) : (
                  <p className="text-center text-xs text-ink-muted">{t.cannotDo}</p>
                )}
                <p className="text-xs leading-5 text-ink-muted">{assistant && !showTopics ? at.scope : t.scope}</p>
                {(context?.enabled ? (modeNoteShared ?? modeNote) : modeNote) ? (
                  <p className="text-xs leading-5 text-ink-muted">{context?.enabled ? (modeNoteShared ?? modeNote) : modeNote}</p>
                ) : null}
              </div>
            ) : (
              <>
                {nextBefore !== null ? (
                  <div className="mb-4 flex justify-center">
                    <button type="button" onClick={loadOlder} className="min-h-10 rounded-xl px-4 text-sm font-semibold text-primary-strong hover:bg-surface-muted">
                      {t.olderMessages}
                    </button>
                  </div>
                ) : null}
                <ol aria-label={t.conversationLabel} aria-live="polite" className="space-y-6">
                  {entries.map((entry) => (
                    <li key={entry.id} className="motion-safe:animate-[fade-in_160ms_ease-out]">
                      <MessageEntry entry={entry} t={t} locale={locale} />
                      {entry.kind === "notice" && entry.handoff ? (
                        <p className="mt-2 text-sm text-ink" dir="auto">
                          {at.handoff.replace("{assistant}", assistantNames[entry.handoff] ?? entry.handoff)}{" "}
                          <a href={`/chat?assistant=${entry.handoff}`} className="font-semibold text-primary-strong underline underline-offset-4">
                            {at.handoffAction.replace("{assistant}", assistantNames[entry.handoff] ?? entry.handoff)}
                          </a>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {pending ? (
              <p role="status" className="mt-6 flex items-center gap-2 text-sm text-ink-muted">
                <span aria-hidden className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.2s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.1s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
                </span>
                {t.replying}
              </p>
            ) : null}
          </div>
        </div>

        <div className="relative border-t border-line bg-canvas">
          {unseen ? (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute -top-14 start-1/2 z-10 inline-flex min-h-10 -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-md rtl:translate-x-1/2"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 5v14M6 13l6 6 6-6" />
              </svg>
              {t.newMessages}
            </button>
          ) : null}
          <div className="mx-auto w-full max-w-3xl space-y-3 px-3 pb-3 pt-3 sm:px-6">
            {failed ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-danger-bg px-4 py-3 text-sm text-danger-ink">
                <span>{translateMessage(locale, failed.message)}</span>
                {failed.code !== "invalid_history" && failed.code !== "history_full" && failed.code !== "not_found" ? (
                  <button
                    type="button"
                    onClick={() => send(failed.text, failed.clientMessageId)}
                    disabled={pending}
                    className="min-h-9 rounded-lg border border-danger-ink/40 px-3 font-semibold"
                  >
                    {t.retry}
                  </button>
                ) : (
                  <button type="button" onClick={newChat} className="min-h-9 rounded-lg border border-danger-ink/40 px-3 font-semibold">
                    {t.newChat}
                  </button>
                )}
              </div>
            ) : null}
            {notice ? (
              <p role="status" className="rounded-2xl bg-surface-muted px-4 py-2 text-sm text-ink">
                {notice}
              </p>
            ) : null}
            {visibleSuggestions.length > 0 && !pending ? (
              <ul aria-label={answered ? t.followUpsLabel : t.suggestionsLabel} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
                {visibleSuggestions.map((s) => (
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => send(s.text)}
                      dir="auto"
                      className="min-h-10 max-w-72 truncate rounded-full border border-line-strong bg-surface px-4 text-sm text-ink hover:border-primary hover:bg-surface-muted"
                    >
                      {s.text}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {offeredDraft ? (
              <div className="mb-2 rounded-2xl border border-line bg-surface-muted px-3 py-2 text-sm" dir="auto">
                <p className="text-xs font-semibold text-ink-muted">{t.draftOffer}</p>
                <p className="mt-1 text-ink">{offeredDraft}</p>
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    className="min-h-9 font-semibold text-primary-strong underline underline-offset-4"
                    onClick={() => {
                      setDraft(offeredDraft);
                      clearDraft();
                      setDraftHandled(true);
                      focusComposer();
                    }}
                  >
                    {t.draftUse}
                  </button>
                  <button
                    type="button"
                    className="min-h-9 text-ink-muted underline underline-offset-4"
                    onClick={() => {
                      clearDraft();
                      setDraftHandled(true);
                    }}
                  >
                    {t.draftDismiss}
                  </button>
                </div>
              </div>
            ) : null}
            {context?.available && actions.setContextEnabled ? (
              <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-ink-muted" dir="auto">
                <span>{context.enabled ? t.context.onLine : t.context.offLine}</span>
                <button
                  type="button"
                  onClick={() => (context.enabled ? shareContext(false) : setContextOpen(true))}
                  disabled={busy}
                  className="min-h-9 font-semibold text-primary-strong underline underline-offset-4 disabled:opacity-50"
                >
                  {context.enabled ? t.context.onAction : t.context.offAction}
                </button>
              </p>
            ) : null}
            <Composer
              t={t}
              value={draft}
              onChange={setDraft}
              onSend={() => send(draft)}
              pending={pending}
              maxLength={maxLength}
              hint={typedInput === "topics" ? t.inputHint : t.freeInputHint}
              placeholder={assistant && !showTopics ? at.placeholder : undefined}
              inputRef={inputRef}
            />
          </div>
        </div>
      </section>

      {contextOpen && context ? (
        <ConsentDialog
          id="context-consent"
          title={t.context.consentTitle}
          points={t.context.consentPoints.map((point) =>
            point
              .replace("{provider}", context.provider ?? "Groq")
              .replace("{model}", context.model ?? "")
              .replace("{region}", t.context.region)
              .replace("{retention}", t.context.groqRetention),
          )}
          agreeLabel={t.context.consentAgree}
          declineLabel={t.context.consentDecline}
          busy={busy}
          error={contextError}
          onAgree={() => shareContext(true)}
          onDecline={() => {
            setContextOpen(false);
            setContextError(null);
          }}
        />
      ) : null}
      {consentOpen && history ? (
        <HistoryConsent
          t={t}
          retentionDays={history.retention_days}
          busy={busy}
          error={consentError}
          onAgree={turnOn}
          onDecline={() => setConsentOpen(false)}
        />
      ) : null}
    </div>
  );
}
