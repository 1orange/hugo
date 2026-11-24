import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { getSettings } from "@/adapters/store/settings";
import { formatDate } from "@/modules/format-sk";
import { latestReleaseNoteId, RELEASE_NOTES } from "@/modules/release-notes";
import { MarkReleaseNotesSeen } from "./mark-seen";

/** What changed in Hugo, for the office (CHANGELOG.md is the developers' version). */
export default async function NovinkyPage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/sign-in");
  }
  if (!isEmailAllowed(session.user.email, loadAllowlistFromEnv())) {
    redirect("/auth/refused");
  }
  const settings = await getSettings();

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <AppBar crumbs={[{ label: "Novinky" }]} email={session.user.email} lastSweepAt={settings.lastSweepAt} />
      <MarkReleaseNotesSeen email={session.user.email} latestId={latestReleaseNoteId()} />
      <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-8">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">Novinky</h1>
        {RELEASE_NOTES.length === 0 ? <p className="text-ink-3">Zatiaľ tu nič nie je.</p> : null}
        {RELEASE_NOTES.map((note) => (
          <section key={note.id} className="inset-group p-5" data-testid={`release-note-${note.id}`}>
            <p className="text-[12.5px] text-ink-3">{formatDate(note.date)}</p>
            <h2 className="mt-0.5 text-[17px] font-semibold text-ink">{note.title}</h2>
            <ul className="mt-3 space-y-3">
              {note.items.map((item) => (
                <li key={item.title}>
                  <p className="text-[14px] font-semibold text-ink">{item.title}</p>
                  <p className="mt-0.5 text-[14px] leading-relaxed text-ink-2">{item.text}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
