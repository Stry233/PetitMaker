import type { RoadFanPattern, RoadMasonryPattern } from '../../../config/catalog/road-material';

type Point = readonly [number, number];

/** A stone's rim stroke width, as a fraction of the joint. */
const RIM = 0.8;

/** How far each stone edge moves inward: half the joint plus half the rim stroke. */
export const stoneInset = (joint: number): number => joint * (1 + RIM) / 2;

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/** Every edge moved `distance` toward the interior, adjacent edges meeting where their offset
 *  lines cross. Empty when the stone is too small to survive the inset. */
export function insetStone(input: readonly Point[], distance: number): Point[] {
  const points = input.filter((p, i) => {
    const q = input[(i + input.length - 1) % input.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9;
  });
  const winding = Math.sign(signedArea(points));
  if (points.length < 3 || !winding) return [];
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length;
    return { px: a[0] - uy * winding * distance, py: a[1] + ux * winding * distance, ux, uy };
  });
  const out = lines.map((line, i): Point => {
    const prev = lines[(i + lines.length - 1) % lines.length]!;
    const cross = prev.ux * line.uy - prev.uy * line.ux;
    if (Math.abs(cross) < 1e-9) return [line.px, line.py];
    const t = ((line.px - prev.px) * line.uy - (line.py - prev.py) * line.ux) / cross;
    return [prev.px + prev.ux * t, prev.py + prev.uy * t];
  });
  // An edge that reverses direction has been consumed by its neighbours.
  const kept = out.every((p, i) => {
    const q = out[(i + 1) % out.length]!;
    return (q[0] - p[0]) * lines[i]!.ux + (q[1] - p[1]) * lines[i]!.uy > 0;
  });
  return kept ? out : [];
}

/** Stones sharing an edge leave exactly one joint of mortar between their rims. Rounded corners cut inside the inset. */
function stone(ctx: CanvasRenderingContext2D, points: readonly Point[], color: string, joint: number): void {
  const inset = insetStone(points, stoneInset(joint));
  if (!inset.length) return;
  ctx.beginPath();
  for (let i = 0; i < inset.length; i++) {
    const p = inset[i]!, prev = inset[(i + inset.length - 1) % inset.length]!, next = inset[(i + 1) % inset.length]!;
    const x = p[0] * 0.84 + prev[0] * 0.16, y = p[1] * 0.84 + prev[1] * 0.16;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    ctx.quadraticCurveTo(p[0], p[1], p[0] * 0.84 + next[0] * 0.16, p[1] * 0.84 + next[1] * 0.16);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  const rim = ctx.createLinearGradient(
    Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1])),
  );
  rim.addColorStop(0, 'rgba(255,236,187,0.32)');
  rim.addColorStop(1, 'rgba(72,41,24,0.32)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = joint * RIM;
  ctx.stroke();
}

export function drawRoadPaving(ctx: CanvasRenderingContext2D, pattern: RoadMasonryPattern | RoadFanPattern, size: number): void {
  ctx.fillStyle = pattern.mortar;
  ctx.fillRect(0, 0, size, size);
  ctx.scale(size, size);
  if (pattern.kind === 'masonry') {
    for (const slab of pattern.stones) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      stone(ctx, slab.points.map(([px, py]) => [px + x, py + y]), slab.color, pattern.joint);
    }
    return;
  }
  const radius = pattern.rings[pattern.rings.length - 1]!.radius;
  // Rear rows cover the straight tops of the foreground semicircles, leaving curved fan joins.
  for (let row = Math.ceil((1 + radius) / pattern.rowSpacing); row >= Math.floor(-radius / pattern.rowSpacing); row--) {
    const shift = row % 2 ? pattern.stagger : 0;
    for (let column = Math.ceil(-radius - shift); column <= Math.floor(1 + radius - shift); column++) {
      const cx = column + shift, cy = row * pattern.rowSpacing;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI);
      ctx.closePath();
      ctx.fillStyle = pattern.mortar;
      ctx.fill();
      let inner = 0;
      for (const [r, ring] of pattern.rings.entries()) {
        for (let segment = 0; segment < ring.segments; segment++) {
          const start = segment * Math.PI / ring.segments, end = (segment + 1) * Math.PI / ring.segments;
          const arc = (rad: number, reverse: boolean): Point[] => Array.from({ length: 5 }, (_, i) => {
            const angle = start + (end - start) * (reverse ? 1 - i / 4 : i / 4);
            return [cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad];
          });
          stone(ctx, [...arc(ring.radius, false), ...arc(inner, true)], ring.colors[(segment + r) % ring.colors.length]!, pattern.joint);
        }
        inner = ring.radius;
      }
    }
  }
}
