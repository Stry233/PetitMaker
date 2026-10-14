import type { RoadInlayPattern, RoadMaterialPattern } from '../../../config/catalog/road-material';
import { surfaceImage } from './surface-image';
import { applySurfaceGrain } from './surface-grain';
import { drawRoadPaving } from './paving-texture';
import { ROAD_TEXTURE_SIZE } from './tile-texture';

const textures = new Map<RoadMaterialPattern, HTMLCanvasElement>();

/** Shared repeat art; boundary colours and markings belong to the surface geometry. */
export function roadMaterialTexture(pattern: RoadMaterialPattern, onReady?: () => void): HTMLCanvasElement {
  if (typeof pattern === 'object' && pattern.kind === 'image') return surfaceImage(pattern, onReady);
  const cached = textures.get(pattern);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = typeof pattern === 'object' ? ROAD_TEXTURE_SIZE * 4 : ROAD_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d')!;
  if (typeof pattern !== 'object' || pattern.kind === 'inlay') {
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    let seed = 0x7a3c921;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const value = 232 + (seed >>> 0) % 24;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  if (typeof pattern === 'object') {
    if (pattern.kind === 'vector') {
      ctx.scale(canvas.width, canvas.height);
      if (pattern.background) { ctx.fillStyle = pattern.background; ctx.fillRect(0, 0, 1, 1); }
      for (const path of pattern.paths) {
        const shape = new Path2D(path.d);
        ctx.globalAlpha = path.opacity ?? 1;
        if (path.fill) {
          ctx.fillStyle = path.fill;
          ctx.fill(shape);
          if (path.relief) {
            const [x, y, w, h] = path.relief.bounds;
            const depth = path.relief.depth;
            const shade = ctx.createLinearGradient(x, y, x + w, y + h);
            shade.addColorStop(0, `rgba(255,245,221,${depth})`);
            shade.addColorStop(.22, 'rgba(255,245,221,0)');
            shade.addColorStop(.7, 'rgba(40,26,24,0)');
            shade.addColorStop(1, `rgba(40,26,24,${depth})`);
            ctx.fillStyle = shade;
            ctx.fill(shape);
            ctx.strokeStyle = shade;
            ctx.lineWidth = Math.min(w, h) * .045;
            ctx.stroke(shape);
          }
        }
        if (path.stroke) { ctx.strokeStyle = path.stroke; ctx.lineWidth = path.width ?? 0.01; ctx.stroke(shape); }
      }
      ctx.globalAlpha = 1;
    } else if (pattern.kind === 'inlay') drawInlay(ctx, pattern, canvas.width);
    else drawRoadPaving(ctx, pattern, canvas.width);
  }
  if (pattern === 'slabs') {
    // The one-cell phase aligns slab joints across independently rebuilt surface regions.
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(0, 0, 1.5, canvas.height);
    ctx.fillRect(0, 0, canvas.width, 1.5);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(1.5, 1.5, 1, canvas.height - 1.5);
    ctx.fillRect(1.5, 1.5, canvas.width - 1.5, 1);
  }
  const detail = typeof pattern === 'object' && 'detail' in pattern ? pattern.detail
    : typeof pattern === 'string' ? { grain: .10, clouds: .16 } : undefined;
  if (detail) applySurfaceGrain(ctx, canvas.width, detail);
  textures.set(pattern, canvas);
  return canvas;
}

function drawInlay(ctx: CanvasRenderingContext2D, pattern: RoadInlayPattern, size: number): void {
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = pattern.background;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  ctx.scale(size, size);
  // Neighbour copies preserve motifs crossing either repeat seam, including corners.
  for (const motif of pattern.motifs) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    ctx.save();
    ctx.translate(motif.x + x, motif.y + y);
    ctx.rotate(motif.rotation * Math.PI / 180);
    ctx.scale(motif.radius, motif.radius);
    const shade = ctx.createRadialGradient(-0.12, -0.18, 0.1, 0, 0, 1);
    shade.addColorStop(0, motif.color ?? pattern.color);
    shade.addColorStop(0.64, motif.color ?? pattern.color);
    shade.addColorStop(1, motif.rim ?? pattern.rim);
    ctx.fillStyle = shade;
    ctx.beginPath();
    if (motif.shape === 'clover') {
      for (let leaf = 0; leaf < 4; leaf++) {
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-0.85, -0.25, -0.8, -1.2, 0, -0.82);
        ctx.bezierCurveTo(0.8, -1.2, 0.85, -0.25, 0, 0);
        ctx.rotate(Math.PI / 2);
      }
    } else if (motif.shape === 'pebble') ctx.ellipse(0, 0, 1, 0.7, 0, 0, Math.PI * 2);
    else if (motif.shape === 'dash') ctx.ellipse(0, 0, 0.46, 1, 0, 0, Math.PI * 2);
    else {
      const points = Array.from({ length: 10 }, (_, i) => {
        const angle = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 0.57 : 1;
        return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      });
      const mix = (a: number, b: number) => a * 0.76 + b * 0.24;
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!, prev = points[(i + 9) % 10]!, next = points[(i + 1) % 10]!;
        const x1 = mix(p.x, prev.x), y1 = mix(p.y, prev.y);
        if (i === 0) ctx.moveTo(x1, y1); else ctx.lineTo(x1, y1);
        ctx.quadraticCurveTo(p.x, p.y, mix(p.x, next.x), mix(p.y, next.y));
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }
}
