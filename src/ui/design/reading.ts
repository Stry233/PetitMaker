/** The translator Help and the tour read their copy through, by the live input mode and layout shape. */
import { useMemo } from 'react';
import { useT } from '../../i18n/context';
import { readingTranslator, type Reading } from '../../i18n/terms/device-readings';
import type { Translate } from '../../i18n/keys';
import { useCurrentInputMode, useLayoutShape } from './input-mode';

/** `useT`, reading a key written for a mouse in the wide arrangement as the live mode and shape read
 *  it (`i18n/terms/device-readings.ts`). */
export function useReadingT(): Translate {
  const t = useT();
  const reading = useReading();
  return useMemo(() => readingTranslator(t, reading), [t, reading]);
}

/** The live input mode and layout shape, as one reading that changes only when either does. */
export function useReading(): Reading {
  const inputMode = useCurrentInputMode();
  const shape = useLayoutShape();
  return useMemo(() => ({ inputMode, shape }), [inputMode, shape]);
}
