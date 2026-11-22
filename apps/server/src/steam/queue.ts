export interface QueueJob<T> {
  id: string;
  run: () => Promise<T>;
  attempts?: number;
}

/**
 * Sequential worker queue. The CS2 Game Coordinator tolerates one request at a
 * time much better than bursts, so concurrency is deliberately fixed at 1.
 */
export class SerialQueue {
  private readonly jobs: QueueJob<unknown>[] = [];
  private running = false;
  private readonly delayMs: number;
  private readonly maxAttempts: number;

  constructor(options: { delayMs?: number; maxAttempts?: number } = {}) {
    this.delayMs = options.delayMs ?? 1200;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  get size(): number {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  add<T>(job: QueueJob<T>): void {
    this.jobs.push(job as QueueJob<unknown>);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()!;
        let lastError: unknown;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
          try {
            await job.run();
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            await sleep(this.delayMs * attempt);
          }
        }
        if (lastError) {
          console.error(`[queue] job ${job.id} failed`, lastError);
        }
        if (this.jobs.length) await sleep(this.delayMs);
      }
    } finally {
      this.running = false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
