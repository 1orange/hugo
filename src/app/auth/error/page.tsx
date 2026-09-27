import Link from "next/link";

type AuthErrorPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const { error } = await searchParams;
  const refused = error === "AccessDenied";

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h1 className="text-lg">
          {refused ? "Prístup odmietnutý" : "Chyba pri prihlásení"}
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          {refused
            ? "Tvoj účet Google nie je na zozname povolených pre túto aplikáciu."
            : "Pri prihlasovaní sa niečo pokazilo. Skús to znova."}
        </p>
        <Link
          className="mt-5 inline-block text-sm font-medium text-accent underline underline-offset-2"
          href="/sign-in"
        >
          Späť na prihlásenie
        </Link>
      </div>
    </main>
  );
}
