/** Every card anchored to a control arrives and leaves on one registered motion. */
import { describe, it, expect } from 'vitest';
import { NO_MOTION } from '../../../ui/design/motion';
import { anchoredCardMotion } from '../../../ui/primitives/AnchoredConfirm';

describe('the anchored card motion', () => {
  it('shows and hides at once under reduced motion', () => {
    const m = anchoredCardMotion(true);
    expect(m.transition).toEqual(NO_MOTION);
    expect((m.exit as { transition: unknown }).transition).toEqual(NO_MOTION);
  });
});
