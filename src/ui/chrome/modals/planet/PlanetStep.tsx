/** One step of a planet window: a `WindowStep` with the planet windows' own spacing. */
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { windowColumn } from '../../../primitives/Window';
import { WindowStep } from '../WindowStep';

/** A step holds the window's head and body; it hands the card's height down to the body. */
const stepStyle: CSSProperties = { ...windowColumn, gap: 18 };

export const PlanetStep = forwardRef<HTMLDivElement, { children: ReactNode }>(function PlanetStep({ children }, ref) {
  return <WindowStep ref={ref} testId="planet-step" style={stepStyle}>{children}</WindowStep>;
});
