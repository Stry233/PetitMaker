/**
 * Values a renderer keeps between road rebuilds, keyed by content. An entry survives while the
 * latest build or the one before it used it, so a rebuild that reuses every entry (a tween frame, a
 * move preview) never evicts, and an entry used before and after one transient build survives it.
 */
export class RoadBuildCache<T> {
  private readonly entries = new Map<string, { value: T; build: number }>();
  private build = 0;

  constructor(private readonly drop?: (value: T) => void) {}

  get(key: string, make: () => T): T {
    const hit = this.entries.get(key);
    if (hit) {
      hit.build = this.build;
      return hit.value;
    }
    const value = make();
    this.entries.set(key, { value, build: this.build });
    return value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Marks an entry as used by this build without reading it. */
  touch(key: string): void {
    const hit = this.entries.get(key);
    if (hit) hit.build = this.build;
  }

  /** Ends a build: drops every entry neither it nor the previous build used. */
  finish(): void {
    for (const [key, entry] of this.entries) {
      if (entry.build >= this.build - 1) continue;
      this.entries.delete(key);
      this.drop?.(entry.value);
    }
    this.build++;
  }

  clear(): void {
    for (const entry of this.entries.values()) this.drop?.(entry.value);
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
