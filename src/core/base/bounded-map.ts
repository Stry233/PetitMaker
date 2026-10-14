/**
 * A `Map` that holds at most `max` entries. Setting a new key while full first drops the entry set
 * longest ago; setting a key already held replaces its value in place. `touch` reads a value and
 * makes it the newest, which turns insertion order into least-recently-used order for the callers
 * that want it.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(readonly max: number) {
    super();
  }

  override set(key: K, value: V): this {
    if (!this.has(key) && this.size >= this.max) {
      const oldest = this.keys().next();
      if (!oldest.done) this.delete(oldest.value);
    }
    return super.set(key, value);
  }

  /** The value under `key`, now the newest entry; undefined, and nothing moved, when absent. */
  touch(key: K): V | undefined {
    if (!this.has(key)) return undefined;
    const value = super.get(key)!;
    this.delete(key);
    super.set(key, value);
    return value;
  }
}

/** A `BoundedMap` of at most `max` entries. */
export const boundedMap = <K, V>(max: number): BoundedMap<K, V> => new BoundedMap<K, V>(max);
