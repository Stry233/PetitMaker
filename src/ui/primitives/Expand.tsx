import { type ReactNode } from 'react';
import { Disclosure } from './Disclosure';

/** Retains field state while collapsed controls are inert. */
export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  return <Disclosure open={open} motionId="section.expand">{children}</Disclosure>;
}
