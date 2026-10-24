"use client";

import { ConsentDialog } from "@/components/chat/consent-dialog";
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
  return (
    <ConsentDialog
      id="history-consent"
      title={t.consentTitle}
      points={t.consentPoints.map((point) => point.replace("{days}", String(retentionDays)))}
      agreeLabel={t.consentAgree}
      declineLabel={t.consentDecline}
      busy={busy}
      error={error}
      onAgree={onAgree}
      onDecline={onDecline}
    />
  );
}
