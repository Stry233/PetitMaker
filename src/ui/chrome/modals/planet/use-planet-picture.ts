/**
 * The map picture a planet painting draws from (`view/map2d/capture/planet-painter.ts:planetPicture`),
 * taken again when the map, its notes, its flagged objects, the locale or the sharpness asked for change. A sharper
 * picture on its way leaves the one shown standing; another map shows nothing until its own lands.
 */
import { useEffect, useState } from 'react';
import { planetPicture, type PlanetPaintInput } from '../../../../view/map2d/capture/planet-painter';
import { onMapRenderer } from '../../../../view/map2d/scene/renderer-registry';
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
    let live = true;
    let unsubscribe: (() => void) | null = null;
    const take = (): void => {
      void planetPicture({
      template, ...(state ? { state } : {}), ...(revision !== undefined ? { revision } : {}), ...(flagged ? { flagged } : {}),
    }, longSidePx).then((picture) => {
        if (!live) return;
        if (picture) { setShown({ subject, picture }); return; }
        // No renderer stands yet: the picture is taken once one does.
        unsubscribe ??= onMapRenderer(() => { unsubscribe?.(); unsubscribe = null; take(); });
      });
    };
    take();
    return () => { live = false; unsubscribe?.(); };
  }, [enabled, subject, state, template, revision, flagged, longSidePx, notes, locale]);

  return shown && shown.subject === subject ? shown.picture : null;
}
