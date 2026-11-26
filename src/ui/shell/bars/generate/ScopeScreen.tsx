import { useMemo, useRef } from 'react';
import { useIsPresent } from 'framer-motion';
import { Action, BarText } from '../bar-atoms';
import { scopeFallsShort } from '../../../../tools/generation/facts';
import { shapeTakesSize, type BuildShape } from '../../../../state/editing/edit-mode';
import { useT } from '../../../../i18n/context';
import type { MacroCoord } from '../../../../core/model/types';
import { DEFAULT_REGION_REQUEST } from '../../../../state/editing/vocabulary';
import { useUiPreviewPose } from '../../../design/preview';
import { useEditorStore } from '../../../../state/store';
import { paintedRegion, regionRequestOf } from '../../../../state/editing/region';
import { helpTargetAttr } from '../../../session/help-targets';
import type { HelpPageId } from '../../../../editor/help/page-schema';
import { QUAD } from '../../units';
import { BrushSizeControl } from '../BrushSizeControl';
import { ToolPill, toolPillCentre, useCellPill } from '../ToolPill';
import { ToolbarHost } from '../toolbar-morph';
import { ShapeOptions } from '../ShapeOptions';
import { DimensionsToggle } from '../DimensionsToggle';
import { InfoLine } from '../../../primitives/InfoLine';
import { useRunCommand } from '../../use-shell-commands';

const NO_REGION: MacroCoord[] = [];

/** The region selection screen standing in the bar's place, offering what the store's region request asks.
 *  `limit` says, on its own line over the tools, why Done is not offered, which it then is not;
 *  `onCancel` adds Cancel, which leaves without a region; `help` is the Help page the screen opens. */
export function ScopeScreen({ onDone, onCancel, limit: liveLimit = null, help = { page: 'region' } }: {
  onDone: () => void; onCancel?: () => void; limit?: string | null; help?: { page: HelpPageId; anchor?: string };
}) {
  const t = useT();
  const cellPill = useCellPill('road');
  const brushPill = cellPill('draw');
  const eraserPill = cellPill('erase');
  // A picture stands the screen over an empty region at its pose.
  const posed = useUiPreviewPose()?.regionScreen;
  const run = useRunCommand();
  const live = {
    region: useEditorStore(paintedRegion),
    tool: useEditorStore(s => s.regionTool), brushShape: useEditorStore(s => s.regionBrushShape),
    size: useEditorStore(s => s.regionBrushSize), dimensions: useEditorStore(s => s.regionDimensions),
    request: useEditorStore(regionRequestOf), limit: liveLimit,
  };
  // On its way out the screen keeps what it last showed: a step ending may give back the region and the
  // request it set aside (`editor/editing/blueprint/steps.ts:beginBlueprintFrame`), which would re-flow it.
  const present = useIsPresent();
  const held = useRef(live);
  if (present) held.current = live;
  const { size, dimensions, limit } = held.current;
  const region = posed ? NO_REGION : held.current.region;
  const tool = posed?.tool ?? held.current.tool;
  const brushShape = posed ? (posed.tool === 'erase' ? held.current.brushShape : posed.tool) : held.current.brushShape;
  const { tools: allowed, minSide } = posed ? DEFAULT_REGION_REQUEST : held.current.request;
  const shapes = allowed.filter((tool): tool is BuildShape => tool !== 'erase');
  const erasing = tool === 'erase';
  const shape = erasing ? brushShape : tool;
  const sized = erasing || shapeTakesSize(tool);

  const tooSmall = useMemo(() => scopeFallsShort(region, minSide), [region, minSide]);
  // Upright, the scope stands in generation's place on its dark plate.
  return <ToolbarHost testId="shell-scope-screen" mapEdge={false} tone="dark" spec={{
    frameAttrs: helpTargetAttr(help.page, help.anchor),
    rows: limit === null ? [] : [{ id: 'scope-limit', node: <span role="status"><BarText role="note" onMap align="left"><InfoLine>{limit}</InfoLine></BarText></span> }],
    pills: [
      { id: 'brush', node: <ToolPill {...brushPill}
        active={!erasing} centre={toolPillCentre(0, erasing ? 1 : 0)} onSelect={() => run(brushPill.commandId)} /> },
      ...(allowed.includes('erase') ? [{ id: 'eraser', node: <ToolPill {...eraserPill}
        active={erasing} centre={toolPillCentre(1, erasing ? 1 : 0)} onSelect={() => run(eraserPill.commandId)} /> }] : []),
    ],
    activePill: erasing ? 'eraser' : 'brush',
    options: [
      // A request offering one figure leaves nothing to choose.
      ...(erasing || shapes.length < 2 ? [] : [{ id: 'shape', node: <ShapeOptions value={shape} shapes={shapes}
        onChange={(next) => run('tool.shape', { value: next })} /> }]),
      { id: 'dimensions', node: <DimensionsToggle value={dimensions} onChange={(on) => run('region.dimensions', { on })} /> },
    ],
    trailing: [
      { id: 'scope-actions', node: <span style={{ display: 'flex', alignItems: 'center', gap: QUAD.gap, marginLeft: 22 - QUAD.gap }}>
        {onCancel && <Action label={t('generate.scope_cancel')} onPress={onCancel} />}
        <Action label={t('generate.clear')} onPress={() => run('region.clear')} />
        <Action label={tooSmall ? t('generate.scope_min', { n: minSide ?? 0 }) : t('generate.scope_done')}
          primary disabled={tooSmall || limit !== null} onPress={onDone} tourTarget="region-done" />
      </span> },
      ...(sized ? [{ id: 'size', end: true, sizeSlider: true, node: <BrushSizeControl value={size} onChange={(next) => run('brush.size', { value: next })} /> }] : []),
    ],
  }}/>;
}