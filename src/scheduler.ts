
export interface SchedulerStatus {
  intervalMs: number;
  startedAt: string;
  lastTickAt: string | null;
  lastError: string | null;
}

export interface Scheduler {
  status(): SchedulerStatus;
  tickNow(): Promise<void>;
  stop(): void;
}

export function startScheduler(tick: () => Promise<void>, intervalMs: number, options: { immediate?: boolean; now?: () => Date } = {}): Scheduler {
  const now = options.now ?? (() => new Date());
  const state: SchedulerStatus = { intervalMs, startedAt: now().toISOString(), lastTickAt: null, lastError: null };
  let busy = false;

  const tickNow = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await tick();
      state.lastError = null;
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      state.lastTickAt = now().toISOString();
      busy = false;
    }
  };

  const timer = setInterval(() => void tickNow(), intervalMs);
  if (options.immediate !== false) void tickNow();
  return { status: () => ({ ...state }), tickNow, stop: () => clearInterval(timer) };
}
