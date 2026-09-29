// Mutations on one host stay ordered; unrelated hosts can make progress.
export class MutationQueue {
  private pending = new Map<string, Promise<void>>();
  run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const result = (this.pending.get(key) ?? Promise.resolve()).then(action);
    const settled = result.then(() => {}, () => {});
    this.pending.set(key, settled);
    void settled.then(() => { if (this.pending.get(key) === settled) this.pending.delete(key); });
    return result;
  }
  async idle(): Promise<void> { await Promise.all(this.pending.values()); }
}
