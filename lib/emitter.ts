/** Minimal event emitter (Bun-native code avoids `node:events`). */
export class Emitter {
  private listeners = new Map<string, Set<(payload: never) => void>>();

  on<T>(event: string, fn: (payload: T) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const wrapped = fn as (payload: never) => void;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  off<T>(event: string, fn: (payload: T) => void): void {
    this.listeners.get(event)?.delete(fn as (payload: never) => void);
  }

  emit<T>(event: string, payload: T): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        (fn as (p: T) => void)(payload);
      } catch (err) {
        console.error(`[emitter] listener for ${event} threw`, err);
      }
    }
  }

  removeAllListeners(event?: string): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
}
