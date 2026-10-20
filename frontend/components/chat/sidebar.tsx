"use client";

import { type FormEvent, useState } from "react";

import type { ConversationSummary, HistorySettings } from "@/lib/api/backend";
import { MAX_TITLE_CHARS } from "@/lib/chat/limits";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

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

const ICON_BUTTON =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted hover:text-ink";

export function Sidebar(props: Props) {
  const { t, locale, history, conversations, activeId, query } = props;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const saving = !!history?.available && history.enabled;
  const showList = !!history?.available && (saving || conversations.length > 0 || query !== "");

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
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-strong"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t.newChat}
        </button>
        {props.onCollapse ? (
          <button type="button" onClick={props.onCollapse} className={ICON_BUTTON} aria-label={t.hideSidebar} title={t.hideSidebar}>
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M9 4v16M15 10l-2 2 2 2" />
            </svg>
          </button>
        ) : null}
        {props.onClose ? (
          <button type="button" onClick={props.onClose} className={ICON_BUTTON} aria-label={t.closeChats}>
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        ) : null}
      </div>

      {showList ? (
        <div className="px-3 pb-2">
          <label htmlFor="chat-search" className="sr-only">
            {t.searchLabel}
          </label>
          <input
            id="chat-search"
            type="search"
            value={query}
            maxLength={80}
            onChange={(e) => props.onQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            dir="auto"
            className="block min-h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-muted"
          />
        </div>
      ) : null}

      <nav aria-label={t.chats} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {showList ? (
          conversations.length === 0 ? (
            <p className="px-2 py-4 text-sm text-ink-muted">{props.searching ? t.loading : query ? t.noResults : t.noSavedChats}</p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => (
                <li key={c.conversation_id} className="group relative">
                  {renaming === c.conversation_id ? (
                    <form onSubmit={(e) => submitRename(e, c.conversation_id)} className="space-y-2 rounded-xl bg-surface-muted p-2">
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
                        className="block min-h-10 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm"
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
                    <div role="alertdialog" aria-label={t.deleteConfirm} className="space-y-2 rounded-xl bg-danger-bg p-3 text-sm text-danger-ink">
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
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => props.onOpen(c.conversation_id)}
                        aria-current={c.conversation_id === activeId ? "page" : undefined}
                        className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-xl px-3 py-2 text-start hover:bg-surface-muted aria-[current=page]:bg-secondary/30 aria-[current=page]:font-semibold"
                      >
                        <span className="w-full truncate text-sm text-ink" dir="auto">
                          {c.title || t.newChat}
                        </span>
                        <span className="text-xs text-ink-muted">{dateLabel(c.last_activity_at, locale)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuFor(menuFor === c.conversation_id ? null : c.conversation_id)}
                        aria-expanded={menuFor === c.conversation_id}
                        aria-haspopup="menu"
                        aria-label={t.chatActions.replace("{title}", c.title)}
                        className={`${ICON_BUTTON} h-9 w-9 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100 ${menuFor === c.conversation_id ? "lg:opacity-100" : ""}`}
                      >
                        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                          <circle cx="5" cy="12" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="19" cy="12" r="1.8" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {menuFor === c.conversation_id && renaming !== c.conversation_id && confirmDelete !== c.conversation_id ? (
                    <div role="menu" className="mt-1 flex gap-1 px-2 pb-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setRenameDraft(c.title);
                          setRenaming(c.conversation_id);
                          setMenuFor(null);
                        }}
                        className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold text-ink hover:bg-surface-muted"
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
                        className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold text-danger-ink hover:bg-danger-bg"
                      >
                        {t.delete}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
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

      <div className="space-y-2 border-t border-line p-3 text-xs text-ink-muted">
        {!history?.available ? (
          <p>{t.historyUnavailable}</p>
        ) : saving ? (
          <>
            <p className="flex items-center gap-2 font-semibold text-ink">
              <span aria-hidden className="h-2 w-2 rounded-full bg-success-ink" />
              {t.historyOnTitle}
            </p>
            <p>{t.retention.replace("{days}", String(history.retention_days))}</p>
            <button type="button" onClick={props.onTurnOff} disabled={props.busy} className="min-h-9 font-semibold text-primary-strong underline underline-offset-4 disabled:opacity-50">
              {t.historyTurnOff}
            </button>
          </>
        ) : (
          <>
            <p className="font-semibold text-ink">{t.historyOffTitle}</p>
            <p>{conversations.length > 0 ? t.historyOffSavedKept : t.historyOffBody}</p>
            <button
              type="button"
              onClick={props.onTurnOn}
              disabled={props.busy}
              className="min-h-10 w-full rounded-xl border border-line-strong px-3 text-sm font-semibold text-ink hover:bg-surface-muted disabled:opacity-50"
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
