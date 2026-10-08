/**
 * Minimal in-process background job runner for fire-and-forget work
 * (notification fan-out, push delivery). Keeps request latency low.
 *
 * Scale-out note: swap `enqueue` for BullMQ/Redis or a Postgres-backed queue
 * (e.g. pg-boss) when running >1 API instance — the call sites don't change.
 */
import { logger } from '../lib/logger';

const pending = new Set<Promise<void>>();

export function enqueue(name: string, fn: () => Promise<void>): void {
  const p = (async () => {
    try {
      await fn();
    } catch (err) {
      logger.error({ err, job: name }, 'Background job failed');
    }
  })();
  pending.add(p);
  p.finally(() => pending.delete(p));
}

/** Await all in-flight jobs (tests + graceful shutdown). */
export async function drainJobs(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
