"use client";

import { type KeyboardEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { Composer } from "@/components/chat/composer";
import { ConsentDialog } from "@/components/chat/consent-dialog";
import { HistoryConsent } from "@/components/chat/history-consent";
import { AssistantIcon } from "@/components/assistants/icons";
import { MessageEntry } from "@/components/chat/messages";
import { Sidebar } from "@/components/chat/sidebar";
import { ArrowIcon, MenuIcon, SidebarIcon } from "@/components/shell/icons";
import { toneStyle } from "@/components/ui/primitives";
import { BY_ID as CATALOG_BY_ID, identity } from "@/lib/assistants/catalog";
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
  const v = messages[locale].v2.chat;
  const tone = identity(assistant?.id ?? "emotional");
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
            handoff: response.handoff && assistantNames[response.handoff] ? response.handoff : null,
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
            suggestions: response.status === "clarify" ? (response.suggestions ?? []) : [],
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
    <div className="tone relative flex min-h-0 flex-1" style={toneStyle(tone.hue, tone.chroma)}>
      {/* Desktop sidebar: slides closed; inert while collapsed so nothing in it can be reached. */}
      <aside
        aria-label={t.chats}
        inert={collapsed}
        className={`hidden shrink-0 overflow-hidden border-line bg-surface/80 backdrop-blur transition-[width] duration-300 ease-[var(--ease-out-soft)] lg:flex lg:flex-col ${collapsed ? "w-0" : "w-[19rem] border-e"}`}
      >
        <div className="flex h-full w-[19rem] flex-col">{sidebar(false)}</div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" onKeyDown={onDrawerKeyDown}>
          <button
            type="button"
            aria-label={t.closeChats}
            className="absolute inset-0 bg-ink/45 backdrop-blur-[2px] motion-safe:animate-[scrim_250ms_ease-out]"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t.chats}
            className="absolute inset-y-0 start-0 flex w-[86%] max-w-[20rem] flex-col rounded-e-[1.75rem] bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-lifted motion-safe:animate-[drawer-ltr_320ms_var(--ease-out-soft)] rtl:motion-safe:animate-[drawer-rtl_320ms_var(--ease-out-soft)]"
          >
            {sidebar(true)}
          </div>
        </div>
      ) : null}

      <section aria-label={t.conversationLabel} className="relative flex min-w-0 flex-1 flex-col">
        <header className="glass relative z-10 flex min-h-16 items-center gap-2 border-x-0 border-t-0 px-3 sm:px-5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={t.openChats}
            aria-expanded={drawerOpen}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted lg:hidden"
          >
            <MenuIcon />
          </button>
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label={t.showSidebar}
              title={t.showSidebar}
              className="hidden h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted lg:inline-flex"
            >
              <SidebarIcon open={false} />
            </button>
          ) : null}
          {assistant ? (
            <span aria-hidden className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--tone-bg)] text-[var(--tone-ink)] ring-1 ring-[var(--tone-line)] sm:flex">
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
          {Object.keys(assistantNames).length > 1 ? (
            <details className="group/switch relative hidden shrink-0 md:block">
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full border border-line bg-surface/70 px-3 text-xs font-semibold text-ink-muted transition-colors hover:text-ink">
                {at.switchLabel}
                <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open/switch:rotate-180" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <ul className="absolute end-0 top-11 z-30 w-72 space-y-0.5 rounded-2xl border border-line bg-surface p-1.5 shadow-lifted motion-safe:animate-[fade-in_180ms_ease-out]">
                {Object.entries(assistantNames).map(([id, name]) => {
                  const other = identity(id);
                  return (
                    <li key={id}>
                      <a
                        href={`/chat?assistant=${id}`}
                        aria-current={id === assistantId ? "page" : undefined}
                        className="tone flex min-h-11 items-center gap-3 rounded-xl px-2.5 text-sm text-ink transition-colors hover:bg-surface-muted aria-[current=page]:bg-[var(--tone-bg)] aria-[current=page]:font-semibold"
                        style={toneStyle(other.hue, other.chroma)}
                        dir="auto"
                      >
                        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--tone-bg)] text-[var(--tone-ink)]">
                          <AssistantIcon name={CATALOG_BY_ID[id]?.icon ?? "sparkles"} className="h-4 w-4" />
                        </span>
                        <span className="truncate">{name}</span>
                      </a>
                    </li>
                  );
                })}
                <li className="border-t border-line pt-1">
                  <a href="/assistants" className="flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-xs font-semibold text-primary-strong hover:bg-surface-muted">
                    {at.all}
                    <ArrowIcon className="h-3.5 w-3.5" />
                  </a>
                </li>
              </ul>
            </details>
          ) : (
            <a href="/assistants" className="hidden shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-primary-strong underline-offset-4 hover:underline sm:inline">
              {at.all}
            </a>
          )}
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${savedNow ? "bg-success-bg text-success-ink" : "bg-surface-muted text-ink-muted"}`}
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${savedNow ? "bg-success-ink" : "bg-line-strong"}`} />
            {savedNow ? t.savedBadge : t.notSavedBadge}
          </span>
          <span className="hidden shrink-0 rounded-full border border-warning-ink/25 px-2.5 py-1 text-xs font-semibold text-warning-ink xl:inline">
            {t.prototype}
          </span>
        </header>

        <div ref={logRef} onScroll={onScroll} className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-70" style={{ background: "radial-gradient(60% 100% at 50% 0%, var(--tone-bg), transparent 70%)" }} />
          <div className="relative mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
            {loadingConversation ? (
              <div role="status" className="space-y-6 py-6">
                <span className="sr-only">{t.loading}</span>
                {[0, 1, 2].map((i) => (
                  <div key={i} className={`flex gap-3 ${i % 2 ? "justify-end" : ""}`}>
                    <span aria-hidden className={`skeleton block h-16 rounded-3xl ${i % 2 ? "w-1/2" : "w-3/4"}`} />
                  </div>
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="space-y-7 py-4 sm:py-10">
                <div className="enter space-y-3 text-center">
                  {assistant ? (
                    <span aria-hidden className="relative mx-auto flex h-20 w-20 items-center justify-center">
                      <span className="absolute inset-0 rounded-[1.75rem] bg-[var(--tone-bg-strong)] opacity-70 blur-xl motion-safe:animate-[breathe_5s_ease-in-out_infinite]" />
                      <span className="relative flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-[var(--tone-bg)] text-[var(--tone-ink)] shadow-soft ring-1 ring-[var(--tone-line)]">
                        <AssistantIcon name={assistant.icon} className="h-8 w-8" />
                      </span>
                    </span>
                  ) : null}
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--tone-ink)]">{v.emptyEyebrow}</p>
                  <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{assistant && !showTopics ? assistant.name : t.welcomeTitle}</h2>
                  <p className="mx-auto max-w-lg text-ink-muted">{assistant && !showTopics ? assistant.description : t.welcomeBody}</p>
                </div>
                {visibleSuggestions.length > 0 && !pending ? (
                  <div className="enter enter-1 space-y-2">
                    <p className="text-center text-sm font-semibold text-ink-muted">{v.startersTitle}</p>
                    <ul aria-label={t.suggestionsLabel} className="grid gap-2 sm:grid-cols-2">
                      {visibleSuggestions.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => send(s.text)}
                            dir="auto"
                            className="lift group flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-start text-sm text-ink shadow-soft hover:border-[var(--tone-line)] hover:shadow-lifted"
                          >
                            <span className="flex-1">{s.text}</span>
                            <ArrowIcon className="h-4 w-4 shrink-0 text-[var(--tone-ink)] opacity-60 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 rtl:group-hover:-translate-x-0.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
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
                ) : null}
                <div className="enter enter-2 space-y-2 rounded-3xl border border-line bg-surface/60 p-4 text-xs leading-5 text-ink-muted">
                  {!showTopics ? <p className="font-semibold text-ink">{t.cannotDo}</p> : null}
                  <p>{assistant && !showTopics ? at.scope : t.scope}</p>
                  {(context?.enabled ? (modeNoteShared ?? modeNote) : modeNote) ? (
                    <p>{context?.enabled ? (modeNoteShared ?? modeNote) : modeNote}</p>
                  ) : null}
                </div>
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
                <ol aria-label={t.conversationLabel} aria-live="polite" className="space-y-7">
                  {entries.map((entry) => (
                    <li key={entry.id} className="motion-safe:animate-[rise_380ms_var(--ease-out-soft)]">
                      <MessageEntry entry={entry} t={t} locale={locale} icon={assistant?.icon ?? "leaf"} />
                      {entry.kind === "notice" && entry.suggestions && entry.suggestions.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-2" aria-label={t.clarifyOptions}>
                          {entry.suggestions.map((s) => (
                            <li key={s}>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => send(s)}
                                dir="auto"
                                className="min-h-11 rounded-full border border-[var(--tone-line)] bg-surface px-4 py-2 text-start text-sm text-ink transition-all hover:-translate-y-0.5 hover:bg-[var(--tone-bg)] disabled:opacity-60"
                              >
                                {s}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {entry.kind !== "user" && entry.handoff ? (
                        <p
                          className="tone mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-[var(--tone-line)] bg-[var(--tone-bg)] px-4 py-3 text-sm text-ink sm:ms-12"
                          style={toneStyle(identity(entry.handoff).hue, identity(entry.handoff).chroma)}
                          dir="auto"
                        >
                          <span>{at.handoff.replace("{assistant}", assistantNames[entry.handoff] ?? entry.handoff)}</span>
                          <a href={`/chat?assistant=${entry.handoff}`} className="inline-flex items-center gap-1 font-semibold text-[var(--tone-ink)] underline underline-offset-4">
                            {at.handoffAction.replace("{assistant}", assistantNames[entry.handoff] ?? entry.handoff)}
                            <ArrowIcon className="h-3.5 w-3.5" />
                          </a>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {pending ? (
              // Honest progress: the reply arrives in one piece (no streaming), so this says
              // what is happening instead of imitating typing.
              <div role="status" className="mt-7 flex gap-3 motion-safe:animate-[rise_300ms_var(--ease-out-soft)]">
                <span aria-hidden className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--tone-bg)] text-[var(--tone-ink)] ring-1 ring-[var(--tone-line)] sm:flex">
                  <AssistantIcon name={assistant?.icon ?? "leaf"} className="h-5 w-5" />
                </span>
                <div className="space-y-2.5 rounded-3xl border border-line bg-surface/80 px-4 py-3 shadow-soft">
                  <p className="flex items-center gap-2.5 text-sm font-medium text-ink">
                    <span aria-hidden className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--tone-solid)] motion-safe:animate-[breathe_1.2s_ease-in-out_infinite]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--tone-solid)] motion-safe:animate-[breathe_1.2s_ease-in-out_0.2s_infinite]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--tone-solid)] motion-safe:animate-[breathe_1.2s_ease-in-out_0.4s_infinite]" />
                    </span>
                    {v.thinking}
                  </p>
                  <p className="text-xs text-ink-muted">{v.thinkingNote}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative bg-gradient-to-t from-canvas via-canvas to-canvas/0 pt-2">
          {unseen ? (
            <button
              type="button"
              onClick={jumpToLatest}
              className="glass absolute -top-12 start-1/2 z-10 inline-flex min-h-10 -translate-x-1/2 items-center gap-2 rounded-full px-4 text-sm font-semibold text-ink shadow-lifted motion-safe:animate-[rise_250ms_var(--ease-out-soft)] rtl:translate-x-1/2"
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
            {visibleSuggestions.length > 0 && !pending && entries.length > 0 ? (
              <ul aria-label={answered ? t.followUpsLabel : t.suggestionsLabel} className="scroll-quiet -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {visibleSuggestions.map((s) => (
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => send(s.text)}
                      dir="auto"
                      className="min-h-10 max-w-72 truncate rounded-full border border-[var(--tone-line)] bg-surface/90 px-4 text-sm text-ink transition-all hover:-translate-y-0.5 hover:bg-[var(--tone-bg)]"
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
