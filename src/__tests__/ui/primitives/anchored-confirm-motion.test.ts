/** Every card anchored to a control arrives and leaves on one registered motion. */
import { describe, it, expect } from 'vitest';
import { amplitude, framerMotion, NO_MOTION } from '../../../ui/design/motion';
import { anchoredCardMotion, anchoredOrigin } from '../../../ui/primitives/AnchoredConfirm';

describe('the anchored card motion', () => {
  it('grows from the registered scale on the registered transition and is put away on the exit ease', () => {
    const m = anchoredCardMotion(false);
    const from = 1 - amplitude('anchored.card.arrive');
    expect(m.initial).toEqual({ scale: from, opacity: 0 });
    expect(m.animate).toEqual({ scale: 1, opacity: 1 });
    expect(m.exit).toEqual({ scale: from, opacity: 0, transition: framerMotion('surface.leave') });
    expect(framerMotion('surface.leave')).toEqual({ duration: 0.16, ease: [0.4, 0, 0.2, 1] });
    expect(m.transition).toEqual(framerMotion('anchored.card.arrive'));
  });

  it('shows and hides at once under reduced motion', () => {
    const m = anchoredCardMotion(true);
    expect(m.transition).toEqual(NO_MOTION);
    expect((m.exit as { transition: unknown }).transition).toEqual(NO_MOTION);
  });

  it('grows from the edge facing its control, on the side it is aligned to', () => {
    expect(anchoredOrigin(false, 'center')).toBe('center top');
    expect(anchoredOrigin(true, 'end')).toBe('right bottom');
    expect(anchoredOrigin(false, 'start')).toBe('left top');
  });

  it('grows from the point on the control once the placement knows it', () => {
    expect(anchoredOrigin(false, 'center', 42)).toBe('42px top');
    expect(anchoredOrigin(true, 'center', 0)).toBe('0px bottom');
  });
});
