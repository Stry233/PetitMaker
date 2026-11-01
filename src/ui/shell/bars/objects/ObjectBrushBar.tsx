/*
 * The brush bar standing in the object shelf's place (EDIT-64), as the region bar stands in the
 * generate shelf's: Place and Paint where the terrain bar keeps its tools, the brush shape and the
 * spacing for Paint, and Done, which gives the shelf back with the card still armed.
 */
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { useUiPreviewPose } from '../../../design/preview';
import { OBJECT_SPACING, type ObjectBrush } from '../../../../state/editing/vocabulary';
import { helpTargetAttr } from '../../../session/help-targets';
import { QUAD, TEXT } from '../../units';
import { Action, BarText } from '../bar-atoms';
import { BrushSizeControl } from '../BrushSizeControl';
import { MapCaption } from '../MapCaption';
import { ShapeOptions } from '../ShapeOptions';
import { CAPTION_TOP, ToolPill, toolPillCentre } from '../ToolPill';
import { ToolbarHost, type ToolbarSlot } from '../toolbar-morph';
import { BRUSH_GLYPHS } from './brush-glyphs';

const HELP = { page: 'objects' as const, anchor: 'objects-batch' };

/** Each way to place: its pill's place in the row, its name and the toolbar command its key runs. */
const BRUSHES = [
  { id: 'place', labelKey: 'objects.place', commandId: 'tool.brush' },
  { id: 'paint', labelKey: 'objects.paint', commandId: 'tool.erase' },
] as const satisfies readonly { id: ObjectBrush; labelKey: string; commandId: string }[];

export function ObjectBrushBar({ onDone }: { onDone: () => void }) {
  const t = useT();
  const posed = useUiPreviewPose()?.objectBrush;
  const liveBrush = useEditorStore((s) => s.objectBrush);
  const brush = posed?.brush ?? liveBrush;
  const setBrush = useEditorStore((s) => s.setObjectBrush);
  const liveShape = useEditorStore((s) => s.objectPaintShape);
  const shape = posed?.shape ?? liveShape;
  const setShape = useEditorStore((s) => s.setObjectPaintShape);
  const painting = brush === 'paint';
  const active = BRUSHES.findIndex((b) => b.id === brush);
  const pills: ToolbarSlot[] = BRUSHES.map(({ id, labelKey, commandId }, index) => ({
    id: `brush-${id}`,
    node: <ToolPill helpTarget={HELP} glyph={BRUSH_GLYPHS[id]} label={t(labelKey)} commandId={commandId}
      active={brush === id} centre={toolPillCentre(index, active)} onSelect={() => setBrush(id)} />,
  }));
  return <ToolbarHost testId="shell-object-brush" mapEdge={false} tone="dark" spec={{
    frameAttrs: helpTargetAttr('objects', 'objects-batch'),
    rows: [],
    pills,
    activePill: `brush-${brush}`,
    options: painting ? [{ id: 'shape', node: <ShapeOptions value={shape} onChange={setShape} /> }] : [],
    trailing: [
      { id: 'brush-done', node: <span style={{ display: 'flex', alignItems: 'center', marginLeft: 22 - QUAD.gap }}>
        <Action label={t('objects.brush_done')} primary onPress={onDone} />
      </span> },
      ...(painting ? [{ id: 'size', end: true, sizeSlider: true, node: <Spacing /> }] : []),
    ],
  }} />;
}

/** The spacing slider, in the size slider's place and on its stops, named under it as the shape group is. */
function Spacing() {
  const t = useT();
  const posed = useUiPreviewPose()?.objectBrush;
  const liveSpacing = useEditorStore((s) => s.objectPaintSpacing);
  const spacing = posed?.spacing ?? liveSpacing;
  const setSpacing = useEditorStore((s) => s.setObjectPaintSpacing);
  const label = t('objects.spacing');
  // A root of its own, so the slider's lift stays inside the box the caption is measured from.
  return <div style={{ position: 'relative', width: '100%', display: 'flow-root' }}>
    <BrushSizeControl value={spacing} onChange={setSpacing} of={{ ...OBJECT_SPACING, label }} />
    <MapCaption top={CAPTION_TOP}><BarText onMap size={TEXT.label}>{label}</BarText></MapCaption>
  </div>;
}
