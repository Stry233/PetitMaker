export class NodeHeap {
  private fs: number[] = [];
  private is: number[] = [];
  get size(): number { return this.fs.length; }
  private less(a: number, b: number): boolean {
    const fa = this.fs[a]!, fb = this.fs[b]!;
    return fa < fb || (fa === fb && this.is[a]! < this.is[b]!);
  }
  push(f: number, i: number): void {
    const fs = this.fs, is = this.is;
    let c = fs.length;
    fs.push(f); is.push(i);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!this.less(c, p)) break;
      const tf = fs[c]!; fs[c] = fs[p]!; fs[p] = tf;
      const ti = is[c]!; is[c] = is[p]!; is[p] = ti;
      c = p;
    }
  }
  /** Pops the (f, i) minimum and returns i. Caller guarantees non-empty. */
  pop(): number {
    const fs = this.fs, is = this.is;
    const top = is[0]!;
    const lf = fs.pop()!, li = is.pop()!;
    if (fs.length > 0) {
      fs[0] = lf; is[0] = li;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1, r = l + 1;
        let m = p;
        if (l < fs.length && this.less(l, m)) m = l;
        if (r < fs.length && this.less(r, m)) m = r;
        if (m === p) break;
        const tf = fs[p]!; fs[p] = fs[m]!; fs[m] = tf;
        const ti = is[p]!; is[p] = is[m]!; is[m] = ti;
        p = m;
      }
    }
    return top;
  }
}
