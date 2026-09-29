// Placeholder landing page. Copy is non-clinical and pending product and
// legal review before any public launch (docs/OPEN_DECISIONS.md).
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <section className="space-y-4">
        <p className="text-sm font-medium text-calm-700">AI Wellness Egypt</p>
        <h1 className="text-4xl font-bold leading-tight">مساحة هادية تهتم فيها بنفسك</h1>
        <p className="text-lg leading-relaxed">
          رفيق رقمي للعافية النفسية، بالعامية المصرية. المنصة لسه تحت التطوير.
        </p>
      </section>

      <section lang="en" dir="ltr" className="space-y-2 text-left">
        <h2 className="text-xl font-semibold">A calm space to look after yourself</h2>
        <p className="leading-relaxed">
          An Egyptian Arabic-first digital wellness companion. This platform is currently in
          development.
        </p>
      </section>

      <aside className="rounded-lg border border-calm-100 bg-white p-5 text-sm leading-relaxed">
        <p>
          المنصة دي للدعم والعافية بس. مش خدمة طبية، ومش بتشخّص أي حالة، ومش بتوصف أدوية،
          ومش بديل عن المتخصصين.
        </p>
        <p lang="en" dir="ltr" className="mt-3 text-left">
          This is a wellness-support product only. It is not a medical service, does not
          diagnose conditions or recommend medication, and is not a replacement for
          professional care.
        </p>
      </aside>
    </main>
  );
}
