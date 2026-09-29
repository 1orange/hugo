export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Every replica migrates on start; an advisory lock makes it happen once.
    const { runMigrations } = await import("./lib/db/client");
    await runMigrations();
    const { hugoRole } = await import("./lib/runtime/role");
    // `npm run dev` and e2e: the worker in this process (ADR 0021).
    if (hugoRole() === "all") {
      const { startWorker } = await import("./lib/worker/start");
      await startWorker();
    }
  }
}
