/*
 * tour.tsx — the figure for the first-launch tour: the REAL shell, pictured, under the tour's own
 * dim. The spotlight geometry is the overlay's (`spotlightRx`, `LIT_INSET`, the same overlay fill
 * and accent ring), cut around the box the 'modes' step measures on the pictured shell, and the
 * card is the real `TourBubble` in the overlay's own card chrome. `TourOverlay` itself is not
 * mounted — it drives the live tour; this shows what it draws without running one.
 */
import { useEffect, useState, type HTMLAttributes } from 'react';
import { colors, radii, z } from '../../../../../design/styles';
import { BUBBLE_W, LIT_INSET, spotlightRx, tourCard, TourBubble } from '../../../../tour/TourOverlay';
import { SHELL_TOUR_STEPS } from '../../../../../shell/tour-steps';
import { tourTargetSelector } from '../../../../tour/steps';
import { PicturedShell, measureBox, useWindowSnapshot, type Box } from './frame-overview';

const INERT = { inert: '' } as unknown as HTMLAttributes<HTMLDivElement>;

const noop = () => {};

/** The spotlight-to-card gap, at the pictured shell's own scale. */
const GAP = 18;

export function TourPreview() {
  const win = useWindowSnapshot();
  const width = 560;
  const scale = width / win.w;
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const step = SHELL_TOUR_STEPS.find((s) => s.id === 'modes');

  useEffect(() => {
    const target = step?.target;
    if (!root || !target) return undefined;
    const read = () => {
      const b = measureBox(root, [tourTargetSelector(target)], win.w, LIT_INSET);
      if (b) setBox(b);
    };
    // Twice: the pictured shell's own entrances can still be settling at the first read.
    const timers = [setTimeout(read, 120), setTimeout(read, 900)];
    return () => timers.forEach(clearTimeout);
  }, [root, step, win.w]);

  if (!step) return null;
  const index = SHELL_TOUR_STEPS.indexOf(step);
  const rx = box ? spotlightRx(box.w, box.h, 1) : 0;

  return (
    <div
      ref={setRoot}
      aria-hidden
      {...INERT}
      style={{
        position: 'relative', width, height: Math.round(win.h * scale), overflow: 'hidden',
        borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none',
      }}
    >
      <PicturedShell win={win} zoom={scale}>
        {/* The tour's dim, cut around the target's box exactly as TourDim cuts it. The cut is a
            box-shadow spill off the lit hole rather than an SVG mask: Chromium drops a masked
            SVG paint under an ancestor CSS zoom, which is the scale every figure rides. Before
            the box lands the dim covers everything, the live overlay's own opening frame. */}
        {box ? (
          <div
            data-testid="help-tour-dim"
            style={{
              position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
              borderRadius: rx, boxSizing: 'border-box',
              border: `3px solid ${colors.accentPrimary}`,
              boxShadow: `0 0 0 ${Math.round(win.w + win.h)}px ${colors.surfaceOverlay}`,
              zIndex: z.unmissable, pointerEvents: 'none',
            }}
          />
        ) : (
          <div
            data-testid="help-tour-dim"
            style={{ position: 'absolute', inset: 0, background: colors.surfaceOverlay, zIndex: z.unmissable, pointerEvents: 'none' }}
          />
        )}
        {box && (
          <div
            style={{
              position: 'absolute',
              left: Math.max(12, Math.min(box.x, win.w - BUBBLE_W - 12)),
              top: box.y + box.h + GAP,
              ...tourCard,
              zIndex: z.unmissable,
              pointerEvents: 'none',
            }}
          >
            <TourBubble
              step={step}
              index={index}
              total={SHELL_TOUR_STEPS.length}
              isLast={index === SHELL_TOUR_STEPS.length - 1}
              onSkip={noop}
              onNext={noop}
            />
          </div>
        )}
      </PicturedShell>
    </div>
  );
}
