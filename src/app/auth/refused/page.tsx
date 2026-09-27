import Link from "next/link";

export default function AuthRefusedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h1 className="text-lg">Prístup odmietnutý</h1>
        <p className="mt-2 text-sm text-ink-2">
          Tvoj účet Google nie je na zozname povolených pre túto aplikáciu. Ak si
          myslíš, že ide o omyl, ozvi sa správcovi.
        </p>
        <Link
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md border border-line-2 bg-surface px-4 text-sm font-medium text-ink-2 hover:border-accent hover:text-accent"
          href="/sign-in"
        >
          Späť na prihlásenie
        </Link>
      </div>
    </main>
  );
}
