/**
 * The map picture a planet painting draws from (`view/map2d/capture/planet-painter.ts:planetPicture`),
 * taken again when the map, its notes, its flagged objects, the locale or the sharpness asked for change. A sharper
 * picture on its way leaves the one shown standing; another map shows nothing until its own lands.
 */
import { useEffect, useState } from 'react';
import { planetPicture, type PlanetPaintInput } from '../../../../view/map2d/capture/planet-painter';
import { useEditorStore } from '../../../../state/store';

export function usePlanetPicture(input: PlanetPaintInput, longSidePx: number, enabled = true): HTMLCanvasElement | null {
  const { state, template, revision, flagged } = input;
  const subject = state ?? template;
  // The notes change in place under the epoch, and their tag labels follow the locale.
  const notes = useEditorStore((s) => s.annotationsEpoch);
  const locale = useEditorStore((s) => s.locale);
  const [shown, setShown] = useState<{ subject: object; picture: HTMLCanvasElement } | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const asked = new AbortController();
    void planetPicture({
      template, ...(state ? { state } : {}), ...(revision !== undefined ? { revision } : {}), ...(flagged ? { flagged } : {}),
    }, longSidePx, asked.signal).then((picture) => { if (picture) setShown({ subject, picture }); });
    return () => asked.abort();
  }, [enabled, subject, state, template, revision, flagged, longSidePx, notes, locale]);

  return shown && shown.subject === subject ? shown.picture : null;
}
