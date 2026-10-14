/*
 * One of the design's drawn glyphs at a chosen apparent size, scaled and centred by its own ink, never its
 * box; the rail and the terrain bar share it.
 */
import type { Glyph } from './frame';
import { apparentSize, opticalCentre } from './frame';

/** `size` is how big the drawing reads: it is scaled by its measured ink and shifted so the ink balances on centre. */
export function GlyphIcon({ glyph, size, flip }: { glyph: Glyph; size: number; flip?: boolean }) {
  const k = (size * (glyph.ink.trim ?? 1)) / apparentSize(glyph.ink);
  const centre = opticalCentre(glyph.ink);
  // Mirroring moves the optical centre to the other side of the box, so the correction mirrors too.
  const dx = (glyph.w / 2 - centre.x) * k * (flip ? -1 : 1);
  const dy = (glyph.h / 2 - centre.y) * k;
  return (
    <span
      aria-hidden
      style={{
        position: 'relative', display: 'block', flex: 'none',
        width: glyph.w * k, height: glyph.h * k,
        transform: `translate(${dx}px, ${dy}px)${flip ? ' scaleX(-1)' : ''}`,
      }}
    >
      {glyph.parts.map((part) => (
        <img
          key={part.src}
          src={part.src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute', left: part.x * k, top: part.y * k,
            width: part.w * k, height: part.h * k,
          }}
        />
      ))}
    </span>
  );
}
