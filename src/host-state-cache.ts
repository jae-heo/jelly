interface Entry<T> { value?: T; updated: number; pending?: Promise<T | undefined> }

// Only list polling uses bounded/stale reads. Actions still await a current probe.
export class HostStateCache<T> {
  private entries = new Map<string, Entry<T>>();
  constructor(private ttl = 1000, private budget = 250, private maxAge = 5000) {}
  invalidate(key: string): void { this.entries.delete(key); }
  async get(key: string, query: () => Promise<T>, bounded = false): Promise<T | undefined> {
    let entry = this.entries.get(key);
    if (!entry) { entry = { updated: 0 }; this.entries.set(key, entry); }
    const current = entry;
    if (bounded && Date.now() - current.updated < this.ttl) return current.value;
    if (!current.pending) {
      current.pending = Promise.resolve().then(query).then(value => value, () => undefined).then(value => {
        current.value = value; current.updated = Date.now(); current.pending = undefined;
        return value;
      });
    }
    if (!bounded) return current.pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        current.pending,
        new Promise<T | undefined>(resolve => { timer = setTimeout(() => resolve(Date.now() - current.updated <= this.maxAge ? current.value : undefined), this.budget); }),
      ]);
    } finally { clearTimeout(timer); }
  }
}
