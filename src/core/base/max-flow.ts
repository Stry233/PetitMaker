// Maximum flow from a source to a sink by Dinic's algorithm over float capacities, and the minimum
// cut it leaves: the move a graph-cut labelling solves. An arc and its reverse sit at indices 2i
// and 2i + 1. The augmenting search is iterative, so a path may be as long as the graph.

/** A residual below this share of the largest capacity counts as saturated, so the cut does not
 *  depend on the costs' scale. */
const RELATIVE_EPS = 1e-9;

export class MaxFlow {
  readonly source: number;
  readonly sink: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;
  private readonly to: Int32Array;
  private readonly cap: Float64Array;
  private readonly level: Int32Array;
  private readonly iter: Int32Array;
  private readonly path: Int32Array;
  private readonly queue: Int32Array;
  private arcs = 0;
  private largest = 0;
  private eps = 0;
  private side: Uint8Array | null = null;

  /** A graph of `nodes` nodes besides the source and the sink, with room for `edges` edges between nodes. */
  constructor(readonly nodes: number, edges: number) {
    const n = nodes + 2;
    this.source = nodes;
    this.sink = nodes + 1;
    const arcs = 2 * (edges + nodes);
    this.head = new Int32Array(n).fill(-1);
    this.next = new Int32Array(arcs);
    this.to = new Int32Array(arcs);
    this.cap = new Float64Array(arcs);
    this.level = new Int32Array(n);
    this.iter = new Int32Array(n);
    this.path = new Int32Array(n);
    this.queue = new Int32Array(n);
  }

  /** Empties the graph for another cut over the same nodes, as a new graph of the same size starts. */
  reset(): void {
    this.head.fill(-1);
    this.arcs = 0;
    this.largest = 0;
    this.eps = 0;
    this.side = null;
  }

  private arc(a: number, b: number, c: number, rc: number): void {
    if (this.arcs + 2 > this.to.length) throw new Error('the flow graph has no room for another edge');
    const i = this.arcs;
    this.largest = Math.max(this.largest, c, rc);
    this.to[i] = b; this.cap[i] = c; this.next[i] = this.head[a]!; this.head[a] = i;
    this.to[i + 1] = a; this.cap[i + 1] = rc; this.next[i + 1] = this.head[b]!; this.head[b] = i + 1;
    this.arcs += 2;
  }

  /** Capacity from the source to `node` and from `node` to the sink. The flow both carry alike
   *  crosses every cut, so only the difference is stored; call once per node. */
  terminal(node: number, fromSource: number, toSink: number): void {
    const m = Math.min(fromSource, toSink);
    if (fromSource - m > 0) this.arc(this.source, node, fromSource - m, 0);
    else if (toSink - m > 0) this.arc(node, this.sink, toSink - m, 0);
  }

  /** Capacity `c` from `a` to `b` and `rc` from `b` to `a`. */
  edge(a: number, b: number, c: number, rc: number): void {
    if (c > 0 || rc > 0) this.arc(a, b, Math.max(0, c), Math.max(0, rc));
  }

  private bfs(): boolean {
    const { level, queue, head, next, to, cap, eps } = this;
    level.fill(-1);
    level[this.source] = 0;
    let qh = 0, qt = 0;
    queue[qt++] = this.source;
    while (qh < qt) {
      const u = queue[qh++]!;
      for (let a = head[u]!; a !== -1; a = next[a]!) {
        const v = to[a]!;
        if (level[v] === -1 && cap[a]! > eps) { level[v] = level[u]! + 1; queue[qt++] = v; }
      }
    }
    return level[this.sink] !== -1;
  }

  /** Pushes one augmenting path of the level graph; 0 when the level graph is blocked. */
  private augment(): number {
    const { level, iter, path, next, to, cap, eps } = this;
    let depth = 0;
    let u = this.source;
    for (;;) {
      if (u === this.sink) {
        let f = Infinity;
        for (let i = 0; i < depth; i++) f = Math.min(f, cap[path[i]!]!);
        for (let i = 0; i < depth; i++) { cap[path[i]!]! -= f; cap[path[i]! ^ 1]! += f; }
        return f;
      }
      let a = iter[u]!;
      while (a !== -1 && !(cap[a]! > eps && level[to[a]!] === level[u]! + 1)) a = next[a]!;
      iter[u] = a;
      if (a === -1) {
        if (depth === 0) return 0;
        level[u] = -1;
        u = to[path[--depth]! ^ 1]!;
        iter[u] = next[iter[u]!]!;
        continue;
      }
      path[depth++] = a;
      u = to[a]!;
    }
  }

  /** Pushes the maximum flow and returns its value, the flow `terminal` set aside excluded. */
  solve(): number {
    this.eps = RELATIVE_EPS * this.largest;
    let flow = 0;
    while (this.bfs()) {
      this.iter.set(this.head);
      for (let f = this.augment(); f > 0; f = this.augment()) flow += f;
    }
    this.side = null;
    return flow;
  }

  /** Whether `node` stays on the source's side of the minimum cut `solve` left. */
  sourceSide(node: number): boolean {
    if (!this.side) {
      const side = new Uint8Array(this.nodes + 2);
      const { queue, head, next, to, cap, eps } = this;
      let qh = 0, qt = 0;
      side[this.source] = 1;
      queue[qt++] = this.source;
      while (qh < qt) {
        const u = queue[qh++]!;
        for (let a = head[u]!; a !== -1; a = next[a]!) {
          const v = to[a]!;
          if (!side[v] && cap[a]! > eps) { side[v] = 1; queue[qt++] = v; }
        }
      }
      this.side = side;
    }
    return this.side[node] === 1;
  }
}
