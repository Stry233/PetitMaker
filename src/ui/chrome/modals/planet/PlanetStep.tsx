/** One step of a planet window: a `WindowStep` with the planet windows' own spacing. */
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { WindowStep } from '../WindowStep';

const stepStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18 };

export const PlanetStep = forwardRef<HTMLDivElement, { children: ReactNode }>(function PlanetStep({ children }, ref) {
  return <WindowStep ref={ref} testId="planet-step" style={stepStyle}>{children}</WindowStep>;
});
