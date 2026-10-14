/** The shelves' backing: a band across the window's foot that cards stand up out of (`units.ts:PLATE_BAND`). */
import { DARK_PLATE } from '../../design/tokens';
import { PLATE_BAND } from '../units';

export function ShelfBand() {
  return (
    <span
      data-testid="bar-plate"
      style={{
        position: 'absolute',
        left: -PLATE_BAND.overhang, right: -PLATE_BAND.overhang,
        bottom: -PLATE_BAND.radius, height: PLATE_BAND.top + PLATE_BAND.radius,
        borderRadius: PLATE_BAND.radius, background: DARK_PLATE,
        // Solid: the shelf root lets the map through around it, but a press or drag on the band is the shelf's.
        pointerEvents: 'auto',
      }}
    />
  );
}
