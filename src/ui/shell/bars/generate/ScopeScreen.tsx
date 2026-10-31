import { useEffect, useMemo } from 'react';
import { Action } from '../bar-atoms';
import { cellEdges } from '../../../../core/model/annotation/dimensions';
import type { BuildShape } from '../../../../state/editing/edit-mode';
import { clearRegion, keepRegionWash, showRegion } from '../../../../editor/editing/region-brush';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { helpTargetAttr } from '../../../session/help-targets';
import { QUAD } from '../../units';
import { BrushSizeControl } from '../BrushSizeControl';
import { ToolPill, toolPillCentre, useCellPill } from '../ToolPill';
import { ToolbarHost } from '../toolbar-morph';
import { ShapeOptions } from '../ShapeOptions';
import { DimensionsToggle } from '../DimensionsToggle';

/** The region selection screen standing in the bar's place, offering what the store's region request asks. */
export function ScopeScreen({ onDone }: { onDone: () => void }) {
  const t = useT();
  const cellPill = useCellPill('road');
  const region = useEditorStore(s => s.region);
  const tool = useEditorStore(s => s.regionTool);
  const brushShape = useEditorStore(s => s.regionBrushShape);
  const setTool = useEditorStore(s => s.setRegionTool);
  const size = useEditorStore(s => s.regionBrushSize);
  const setSize = useEditorStore(s => s.setRegionBrushSize);
  const dimensions = useEditorStore(s => s.regionDimensions);
  const setDimensions = useEditorStore(s => s.setRegionDimensions);
  const { tools: allowed, minSide } = useEditorStore(s => s.regionRequest);
  const shapes = allowed.filter((tool): tool is BuildShape => tool !== 'erase');
  const erasing = tool === 'erase';
  const shape = erasing ? brushShape : tool;
  const sized = erasing || (tool !== 'rect' && tool !== 'circle');

  const template = useEditorStore(s => s.gridState?.template);
  // The template sets the guides' ink scale, which the overlay reads.
  useEffect(() => { showRegion(region, dimensions); }, [region, dimensions, template]);

  // Done retains the scope wash, while dimensions belong only to the editing screen.
  useEffect(() => keepRegionWash, []);

  const bounds = useMemo(() => cellEdges(region), [region]);
  const tooSmall = minSide !== null && bounds !== null
    && Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) < minSide;
  // Upright, the scope stands in generation's place on its dark plate.
  return <ToolbarHost testId="shell-scope-screen" mapEdge={false} tone="dark" spec={{
    frameAttrs: helpTargetAttr('region'),
    rows: [],
    pills: [
      { id: 'brush', node: <ToolPill {...cellPill('draw')}
        active={!erasing} centre={toolPillCentre(0, erasing ? 1 : 0)}
        onSelect={() => setTool(allowed.includes(brushShape) ? brushShape : allowed[0]!)} /> },
      ...(allowed.includes('erase') ? [{ id: 'eraser', node: <ToolPill {...cellPill('erase')}
        active={erasing} centre={toolPillCentre(1, erasing ? 1 : 0)} onSelect={() => setTool('erase')} /> }] : []),
    ],
    activePill: erasing ? 'eraser' : 'brush',
    options: [
      ...(erasing ? [] : [{ id: 'shape', node: <ShapeOptions value={shape} shapes={shapes}
        onChange={setTool} /> }]),
      { id: 'dimensions', node: <DimensionsToggle value={dimensions} onChange={setDimensions} /> },
    ],
    trailing: [
      { id: 'scope-actions', node: <span style={{ display: 'flex', alignItems: 'center', gap: QUAD.gap, marginLeft: 22 - QUAD.gap }}>
        <Action label={t('generate.clear')} onPress={clearRegion} />
        <Action label={tooSmall ? t('generate.scope_min', { n: minSide ?? 0 }) : t('generate.scope_done')}
          primary disabled={tooSmall} onPress={onDone} />
      </span> },
      ...(sized ? [{ id: 'size', end: true, sizeSlider: true, node: <BrushSizeControl value={size} onChange={setSize} /> }] : []),
    ],
  }}/>;
}