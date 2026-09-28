/**
 * Jobs run in the background, each key at most once at a time: a key already
 * waiting or running is not added again. Page renders enqueue freely — the
 * month view re-renders every 1.5 s while documents are pending, and each
 * render used to start the same documents over.
 */
export class KeyedQueue<T> {
  private readonly waiting = new Map<string, T>();
  private readonly running = new Set<string>();
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly worker: (job: T) => Promise<void>,
    private readonly concurrency: number,
  ) {}

  /** Adds the job unless its key is already waiting or running; true if added. */
  enqueue(key: string, job: T): boolean {
    if (this.waiting.has(key) || this.running.has(key)) {
      return false;
    }
    this.waiting.set(key, job);
    this.pump();
    return true;
  }

  has(key: string): boolean {
    return this.waiting.has(key) || this.running.has(key);
  }

  get size(): number {
    return this.waiting.size + this.running.size;
  }

  /** Resolves once nothing is waiting or running. */
  onIdle(): Promise<void> {
    if (this.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.waiting.size > 0) {
      const [key, job] = this.waiting.entries().next().value as [string, T];
      this.waiting.delete(key);
      this.running.add(key);
      void this.worker(job)
        .catch(() => {
          // The worker records its own failures; the queue only keeps going.
        })
        .finally(() => {
          this.running.delete(key);
          this.pump();
          if (this.size === 0) {
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            waiters.forEach((resolve) => resolve());
          }
        });
    }
  }
}
