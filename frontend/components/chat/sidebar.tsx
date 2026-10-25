"use client";

import { type FormEvent, useState } from "react";

import { CloseIcon, DotsIcon, LockIcon, PlusIcon, SearchIcon, SidebarIcon } from "@/components/shell/icons";
import type { ConversationSummary, HistorySettings } from "@/lib/api/backend";
import { MAX_TITLE_CHARS } from "@/lib/chat/limits";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { messages } from "@/lib/i18n/messages";

type Props = {
  t: Messages["chat"];
  locale: Locale;
  history: HistorySettings | null;
  conversations: ConversationSummary[];
  activeId: string | null;
  query: string;
  onQuery: (q: string) => void;
  searching: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onNewChat: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onTurnOn: () => void;
  onTurnOff: () => void;
  onDeleteAll: () => Promise<void>;
  onCollapse?: () => void;
  onClose?: () => void;
  busy: boolean;
};

function dateLabel(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }).format(date);
}

type Bucket = "today" | "yesterday" | "week" | "older";

function bucketOf(iso: string): Bucket {
  const date = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = (start.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000;
  if (diff <= 0) return "today";
  if (diff <= 1) return "yesterday";
  if (diff <= 7) return "week";
  return "older";
}

const ICON_BUTTON =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink";

export function Sidebar(props: Props) {
  const { t, locale, history, conversations, activeId, query } = props;
  const v = messages[locale].v2.chat;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const saving = !!history?.available && history.enabled;
  const showList = !!history?.available && (saving || conversations.length > 0 || query !== "");
  const groupNames: Record<Bucket, string> = { today: v.groupToday, yesterday: v.groupYesterday, week: v.groupWeek, older: v.groupOlder };
  // Search results are shown flat (ranked by the server); the full list is grouped by date.
  const groups: [Bucket | null, ConversationSummary[]][] = query
    ? [[null, conversations]]
    : (["today", "yesterday", "week", "older"] as const)
        .map((b): [Bucket, ConversationSummary[]] => [b, conversations.filter((c) => bucketOf(c.last_activity_at) === b)])
        .filter(([, list]) => list.length > 0);

  async function submitRename(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (await props.onRename(id, renameDraft)) setRenaming(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={props.onNewChat}
          className="group inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-sm font-semibold text-canvas shadow-soft transition-all duration-200 hover:shadow-lifted active:translate-y-px"
        >
          <PlusIcon className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
          {t.newChat}
        </button>
        {props.onCollapse ? (
          <button type="button" onClick={props.onCollapse} className={ICON_BUTTON} aria-label={t.hideSidebar} title={t.hideSidebar}>
            <SidebarIcon open />
          </button>
        ) : null}
        {props.onClose ? (
          <button type="button" onClick={props.onClose} className={ICON_BUTTON} aria-label={t.closeChats}>
            <CloseIcon />
          </button>
        ) : null}
      </div>

      {showList ? (
        <div className="px-3 pb-2">
          <label className="flex min-h-10 items-center gap-2 rounded-xl border border-line bg-canvas/70 px-3 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-focus/40">
            <span className="sr-only">{t.searchLabel}</span>
            <SearchIcon className="h-4 w-4 shrink-0 text-ink-muted" />
            <input
              id="chat-search"
              type="search"
              value={query}
              maxLength={80}
              onChange={(e) => props.onQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              dir="auto"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
            />
          </label>
        </div>
      ) : null}

      <nav aria-label={t.chats} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {showList ? (
          conversations.length === 0 ? (
            <div className="mx-1 mt-2 rounded-2xl border border-dashed border-line-strong/40 px-4 py-6 text-center text-sm text-ink-muted">
              {props.searching ? t.loading : query ? t.noResults : t.noSavedChats}
            </div>
          ) : (
            groups.map(([bucket, list]) => (
              <div key={bucket ?? "results"} className="mb-2">
                {bucket ? <p className="px-3 pb-1 pt-3 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-muted">{groupNames[bucket]}</p> : null}
                <ul className="space-y-0.5">
                  {list.map((c) => (
                    <li key={c.conversation_id} className="group relative">
                      {renaming === c.conversation_id ? (
                        <form onSubmit={(e) => submitRename(e, c.conversation_id)} className="space-y-2 rounded-2xl bg-surface-muted p-2">
                          <label htmlFor={`rename-${c.conversation_id}`} className="sr-only">
                            {t.renameLabel}
                          </label>
                          <input
                            id={`rename-${c.conversation_id}`}
                            value={renameDraft}
                            maxLength={MAX_TITLE_CHARS}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                            dir="auto"
                            autoFocus
                            className="block min-h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm"
                          />
                          <div className="flex gap-2">
                            <button type="submit" disabled={props.busy || !renameDraft.trim()} className="min-h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-on-primary disabled:opacity-50">
                              {t.save}
                            </button>
                            <button type="button" onClick={() => setRenaming(null)} className="min-h-9 rounded-lg px-3 text-xs font-semibold text-ink-muted hover:bg-surface">
                              {t.cancel}
                            </button>
                          </div>
                        </form>
                      ) : confirmDelete === c.conversation_id ? (
                        <div role="alertdialog" aria-label={t.deleteConfirm} className="space-y-2 rounded-2xl bg-danger-bg p-3 text-sm text-danger-ink motion-safe:animate-[fade-in_200ms_ease-out]">
                          <p>{t.deleteConfirm}</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={props.busy}
                              onClick={async () => {
                                await props.onDelete(c.conversation_id);
                                setConfirmDelete(null);
                              }}
                              className="min-h-9 rounded-lg bg-danger-ink px-3 text-xs font-semibold text-surface disabled:opacity-50"
                            >
                              {t.delete}
                            </button>
                            <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-9 rounded-lg px-3 text-xs font-semibold hover:bg-surface/50">
                              {t.cancel}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="relative flex items-center">
                          <button
                            type="button"
                            onClick={() => props.onOpen(c.conversation_id)}
                            aria-current={c.conversation_id === activeId ? "page" : undefined}
                            className="peer flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-xl px-3 py-2 text-start transition-colors hover:bg-surface-muted aria-[current=page]:bg-primary/10"
                          >
                            <span className="w-full truncate text-sm text-ink" dir="auto">
                              {c.title || t.newChat}
                            </span>
                            <span className="text-xs text-ink-muted">{dateLabel(c.last_activity_at, locale)}</span>
                          </button>
                          <span
                            aria-hidden
                            className="pointer-events-none absolute inset-y-2 start-0 w-1 scale-y-0 rounded-full bg-primary transition-transform duration-300 peer-aria-[current=page]:scale-y-100"
                          />
                          <button
                            type="button"
                            onClick={() => setMenuFor(menuFor === c.conversation_id ? null : c.conversation_id)}
                            aria-expanded={menuFor === c.conversation_id}
                            aria-haspopup="menu"
                            aria-label={t.chatActions.replace("{title}", c.title)}
                            className={`${ICON_BUTTON} h-9 w-9 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100 ${menuFor === c.conversation_id ? "lg:opacity-100" : ""}`}
                          >
                            <DotsIcon />
                          </button>
                        </div>
                      )}
                      {menuFor === c.conversation_id && renaming !== c.conversation_id && confirmDelete !== c.conversation_id ? (
                        <div
                          role="menu"
                          className="mx-2 mb-1 mt-1 flex gap-1 rounded-xl border border-line bg-surface p-1 shadow-lifted motion-safe:animate-[fade-in_180ms_ease-out]"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setRenameDraft(c.title);
                              setRenaming(c.conversation_id);
                              setMenuFor(null);
                            }}
                            className="min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold text-ink hover:bg-surface-muted"
                          >
                            {t.rename}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setConfirmDelete(c.conversation_id);
                              setMenuFor(null);
                            }}
                            className="min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold text-danger-ink hover:bg-danger-bg"
                          >
                            {t.delete}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )
        ) : null}
        {showList && props.hasMore && !query ? (
          <button
            type="button"
            onClick={props.onLoadMore}
            disabled={props.loadingMore}
            className="mt-2 min-h-10 w-full rounded-xl text-sm font-semibold text-primary-strong hover:bg-surface-muted disabled:opacity-50"
          >
            {props.loadingMore ? t.loading : t.loadMore}
          </button>
        ) : null}
      </nav>

      <div className="m-3 space-y-2 rounded-2xl border border-line bg-canvas/60 p-3 text-xs text-ink-muted">
        {!history?.available ? (
          <p>{t.historyUnavailable}</p>
        ) : saving ? (
          <>
            <p className="flex items-center gap-2 font-semibold text-ink">
              <span aria-hidden className="relative flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-success-ink motion-safe:animate-[breathe_3s_ease-in-out_infinite]" />
                <span className="relative h-2 w-2 rounded-full bg-success-ink" />
              </span>
              {t.historyOnTitle}
            </p>
            <p>{t.retention.replace("{days}", String(history.retention_days))}</p>
            <button type="button" onClick={props.onTurnOff} disabled={props.busy} className="min-h-9 font-semibold text-primary-strong underline underline-offset-4 disabled:opacity-50">
              {t.historyTurnOff}
            </button>
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 font-semibold text-ink">
              <LockIcon className="h-4 w-4 text-ink-muted" />
              {t.historyOffTitle}
            </p>
            <p>{conversations.length > 0 ? t.historyOffSavedKept : t.historyOffBody}</p>
            <button
              type="button"
              onClick={props.onTurnOn}
              disabled={props.busy}
              className="min-h-10 w-full rounded-xl border border-line-strong/60 bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-primary hover:text-primary-strong disabled:opacity-50"
            >
              {t.historyTurnOn}
            </button>
          </>
        )}
        {history?.available && conversations.length > 0 ? (
          confirmAll ? (
            <div role="alertdialog" aria-label={t.deleteAllConfirm} className="space-y-2 rounded-xl bg-danger-bg p-3 text-danger-ink">
              <p>{t.deleteAllConfirm}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={async () => {
                    await props.onDeleteAll();
                    setConfirmAll(false);
                  }}
                  className="min-h-9 rounded-lg bg-danger-ink px-3 font-semibold text-surface disabled:opacity-50"
                >
                  {t.deleteAllYes}
                </button>
                <button type="button" onClick={() => setConfirmAll(false)} className="min-h-9 rounded-lg px-3 font-semibold">
                  {t.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmAll(true)} className="block min-h-9 font-semibold text-danger-ink underline underline-offset-4">
              {t.deleteAll}
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
