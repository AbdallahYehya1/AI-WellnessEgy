import { PublicShell } from "@/components/shell/public-shell";
import { ButtonLink, Card } from "@/components/ui/primitives";
import { getMessages } from "@/lib/i18n/server";

// Public welcome page. Claims are limited to what exists today; copy is
// pending product and legal review before any public launch (D-11, D-19).
export default async function HomePage() {
  const { locale, t } = await getMessages();
  const l = t.landing;
  return (
    <PublicShell locale={locale} t={t} wide>
      <div className="space-y-10 py-4">
        <section className="space-y-5">
          <p className="text-sm font-semibold text-primary-strong">{l.eyebrow}</p>
          <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">{l.title}</h1>
          <p className="max-w-2xl text-lg text-ink-muted">{l.lead}</p>
          <nav aria-label={t.common.signIn} className="flex flex-wrap gap-3">
            <ButtonLink href="/sign-up">{l.getStarted}</ButtonLink>
            <ButtonLink href="/sign-in" variant="secondary">
              {l.haveAccount}
            </ButtonLink>
          </nav>
        </section>

        <section aria-labelledby="how" className="space-y-4">
          <h2 id="how" className="text-xl font-bold">
            {l.howTitle}
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {l.steps.map((step, index) => (
              <li key={step.title}>
                <Card as="div" className="h-full">
                  <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted font-bold text-primary-strong">
                    {index + 1}
                  </span>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{step.body}</p>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h2 className="font-bold">{l.privacyTitle}</h2>
            <p className="mt-1 text-sm text-ink-muted">{l.privacyBody}</p>
          </Card>
          <Card>
            <h2 className="font-bold">{l.limitsTitle}</h2>
            <p className="mt-1 text-sm text-ink-muted">{l.limitsBody}</p>
          </Card>
        </section>
      </div>
    </PublicShell>
  );
}
