/** The map a pictured surface stands over, as the live surface stands over the editor's map. */
import { useEffect, useState } from 'react';
import { useEditorStore } from '../../../../state/store';
import { renderThumbnail } from '../../../../view/map2d/capture/thumbnail';
import { DEFAULT_MAP } from '../../../../config/maps';
import { bareGridState } from '../../../../core/model/template';
import type { GridState } from '../../../../core/model/types';

/** The visitor's own map (a bare default map before one exists), drawn by the 2D renderer's capture. */
export function useMapBackdrop(aspect: number): string | null {
  const grid = useEditorStore((s) => s.gridState);
  const [png, setPng] = useState<string | null>(null);
  useEffect(() => {
    let dropped = false;
    const subject: GridState = grid ?? bareGridState(DEFAULT_MAP);
    void renderThumbnail(subject, 1024, { aspect }).then((p) => { if (!dropped && p) setPng(p); });
    return () => { dropped = true; };
  }, [grid, aspect]);
  return png;
}
