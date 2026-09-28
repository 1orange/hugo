export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./lib/db/migrate");
    runMigrations();
    // Documents are read as they arrive in Drive (ADR 0020).
    const { startDriveWatcher } = await import("./lib/drive-watch/drive-watch");
    startDriveWatcher();
  }
}
