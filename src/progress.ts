export interface Remembered {
  status: 'retry' | 'invalid' | 'skipped' | 'error' | 'failed' | 'unconfirmed' | 'posted';
  message: string;
  at: string;
}

interface Store {
  steps: Map<string, string>;
  outcomes: Map<string, Remembered>;
}

const KEY = Symbol.for('social.progress');
const holder = globalThis as { [KEY]?: Store };
const store = (): Store => (holder[KEY] ??= { steps: new Map(), outcomes: new Map() });

export const setProgress = (id: string, text: string): void => void store().steps.set(id, text);
export const getProgress = (id: string): string | null => store().steps.get(id) ?? null;
export const clearProgress = (id: string): void => void store().steps.delete(id);

export function rememberOutcome(id: string, outcome: Remembered): void {
  store().outcomes.set(id, outcome);
}

export function lastOutcome(id: string): Remembered | null {
  return store().outcomes.get(id) ?? null;
}

export function forgetOutcome(id: string): void {
  store().outcomes.delete(id);
}
