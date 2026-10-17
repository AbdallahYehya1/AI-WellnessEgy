import { PublicShell } from "@/components/shell/public-shell";
import { ButtonLink } from "@/components/ui/primitives";
import { getMessages } from "@/lib/i18n/server";

export default async function NotFound() {
  const { locale, t } = await getMessages();
  return (
    <PublicShell locale={locale} t={t} title={t.errors.notFoundTitle}>
      <p className="text-ink-muted">{t.errors.notFoundBody}</p>
      <ButtonLink href="/" full>
        {t.errors.goHome}
      </ButtonLink>
    </PublicShell>
  );
}
