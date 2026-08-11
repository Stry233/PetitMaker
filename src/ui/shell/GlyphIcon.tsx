/*
 * GlyphIcon.tsx — one of the design source's drawn glyphs, at a chosen APPARENT size.
 *
 * It belongs beside `frame.ts` rather than to either of the two rows that use it: the rail draws
 * its undo, zoom and rotate marks with it and the terrain bar draws its surfaces with it, and the
 * rule it carries — a drawing is scaled and centred by its own INK, never by its box — is the same
 * rule for both.
 */
import type { Glyph } from './frame';
import { apparentSize, opticalCentre } from './frame';

/**
 * `size` is how big the drawing should read, not how tall its box is: each drawing is scaled by its
 * own measured ink and then shifted so that ink balances on the box's centre. Drawn to their boxes
 * instead, a family of glyphs comes out at sizes a fifth apart and none of them over the middle of
 * its button, because a glyph's box is the artist's canvas and not the picture.
 */
export function GlyphIcon({ glyph, size, flip }: { glyph: Glyph; size: number; flip?: boolean }) {
  const k = size / apparentSize(glyph.ink);
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
