/*
 * EraserShapeChip.tsx — what one eraser gesture takes back, riding inside the eraser cell's pill.
 *
 * The same control auto trim is (`SettingChip`), on the eraser's own setting: a DAB under the brush,
 * or a rectangle or circle dragged out and taken on release. Only the eraser cell carries it
 * (`terrain-cells.ts:ToolCell.eraserShape`).
 *
 * THE DAB COUNTS AS ON. Auto trim has an off state and this does not: every state erases, so the
 * chip wears its working plate throughout and the drawing alone says which figure a press will take.
 */
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { ES_NEXT, ES_STATE_KEY, eraserShapeGlyph } from './eraser-shape-glyph';
import { SettingChip } from './SettingChip';

export function EraserShapeChip() {
  const t = useT();
  const shape = useEditorStore((s) => s.eraserShape);
  const setEraserShape = useEditorStore((s) => s.setEraserShape);

  return (
    <SettingChip
      state={shape}
      name={t(ES_STATE_KEY[shape])}
      label={t('eraser.shape')}
      on
      glyph={(size, color) => eraserShapeGlyph(shape, size, color)}
      onCycle={() => setEraserShape(ES_NEXT[shape])}
    />
  );
}
