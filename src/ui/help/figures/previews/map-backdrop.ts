/** The map a pictured surface stands over, as the live surface stands over the editor's map. */
import { useMemo } from 'react';
import { useEditorStore } from '../../../../state/store';
import { DEFAULT_MAP } from '../../../../config/maps';
import { bareGridState } from '../../../../core/model/template';
import { useMapShot } from '../../../agent/parts/map-shot';

/** The visitor's own map (a bare default map before one exists), drawn by the 2D renderer's capture. */
export function useMapBackdrop(aspect: number): string | null {
  const grid = useEditorStore((s) => s.gridState);
  const subject = useMemo(() => grid ?? bareGridState(DEFAULT_MAP), [grid]);
  return useMapShot(subject, 1024, { aspect, hold: true });
}
