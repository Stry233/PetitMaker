import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { annotationInkScale } from '../../../core/model/annotations';
import { cellEdges } from '../../../core/model/annotation-dimensions';
import type { BuildShape } from '../../../core/model/edit-mode';
import type { RegionTool } from '../../../core/model/types';
import { clearRegionSelection, REGION_TOOLS, regionTools, setRegionMinSide, setRegionSingle, setRegionTools } from '../../../core/runtime/region-brush';
import { host } from '../../../kit/host';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { cssMotion } from '../../design/motion';
import { ScaleProvider } from '../../design/scale';
import { btnReset, buttonMotion, cursors, UNAVAILABLE, z, radii } from '../../design/styles';
import { ACTIVE, PLATE, PLATE_INK } from '../../design/tokens';
import { useFrameLayout } from '../frame-layout';
import { EDGE_RIGHT, QUAD, SCALE, TEXT } from '../units';
import { BarText } from './bar-atoms';
import { BrushSizeControl } from './BrushSizeControl';
import { CELL_BOX } from './ToolCell';
import { ToolPill, TOOL_PILL_GAP, toolPillCentre } from './ToolPill';
import { ToolRow } from './ToolRow';
import { ToolOptions } from './ToolOptions';
import { ShapeOptions } from './ShapeOptions';
import { TOOL_CELLS } from './terrain-cells';
import { DimensionsToggle } from './DimensionsToggle';

export function Action({ label, primary, disabled, onPress }: {
  label: string; primary?: boolean; disabled?: boolean; onPress: () => void;
}) {
  return (
    <motion.button
      type="button"
      {...(disabled ? {} : buttonMotion)}
      aria-disabled={disabled}
      onClick={() => { if (!disabled) onPress(); }}
      style={{
        ...btnReset, flex: 'none', pointerEvents: 'auto',
        cursor: disabled ? cursors.blocked : cursors.clickable,
        opacity: disabled ? UNAVAILABLE : 1,
        height: CELL_BOX.h, padding: '0 18px', borderRadius: radii.pill,
        background: primary ? ACTIVE : PLATE,
        display: 'flex', alignItems: 'center',
      }}
    >
      <BarText size={TEXT.label} color={PLATE_INK}>{label}</BarText>
    </motion.button>
  );
}

interface ScopeScreenProps {
  onDone: () => void;
  tools?: readonly RegionTool[];
  /** A minimum side also restricts the selection to one replaceable figure. */
  minSide?: number;
}

export function ScopeScreen(props: ScopeScreenProps) {
  return <ScaleProvider value={SCALE}><ScopeScreenBody {...props} /></ScaleProvider>;
}

function ScopeScreenBody({ onDone, tools, minSide }: ScopeScreenProps) {
  const layout = useFrameLayout();
  const t = useT();
  const region = useEditorStore(s => s.region);
  const template = useEditorStore(s => s.gridState?.template);
  const tool = useEditorStore(s => s.regionTool);
  const brushShape = useEditorStore(s => s.regionBrushShape);
  const setTool = useEditorStore(s => s.setRegionTool);
  const size = useEditorStore(s => s.regionBrushSize);
  const setSize = useEditorStore(s => s.setRegionBrushSize);
  const dimensions = useEditorStore(s => s.regionDimensions);
  const setDimensions = useEditorStore(s => s.setRegionDimensions);
  const allowed = tools ?? REGION_TOOLS;
  const shapes = allowed.filter(tool => tool !== 'eraser').map(tool => tool === 'brush' ? 'free' : tool) as BuildShape[];
  const erasing = tool === 'eraser';
  const shape = erasing ? brushShape : tool;
  const sized = erasing || (tool !== 'rect' && tool !== 'circle');

  useEffect(() => {
    setRegionTools(tools);
    const allowed = regionTools();
    const current = useEditorStore.getState().regionTool;
    if (!allowed.includes(current) && allowed[0]) setTool(allowed[0]);
    setRegionSingle(minSide !== undefined);
    setRegionMinSide(minSide ?? null);
    return () => { setRegionTools(); setRegionSingle(false); setRegionMinSide(null); };
  }, [tools, minSide, setTool]);

  useEffect(() => {
    if (region.length) host.buildableRegion.show(region, dimensions && template ? annotationInkScale(template) : undefined);
    else host.buildableRegion.clear();
  }, [region, dimensions, template]);

  // Done retains the scope wash, while dimensions belong only to the editing screen.
  useEffect(() => () => {
    const cells = useEditorStore.getState().region;
    if (cells.length) host.buildableRegion.show(cells);
  }, []);

  const bounds = useMemo(() => cellEdges(region), [region]);
  const tooSmall = minSide !== undefined && bounds !== null
    && Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) < minSide;
  return <div data-testid="shell-scope-screen" {...helpTargetAttr('region')} style={{
    position: 'fixed', left: QUAD.left, right: layout?.edgeRight ?? EDGE_RIGHT, bottom: QUAD.bottom, zIndex: z.panel,
    transition: cssMotion('frame.layout.adapt', ['right']), pointerEvents: 'none',
  }}>
    <ToolRow>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: TOOL_PILL_GAP, flex: 'none' }}>
        <ToolPill glyph={TOOL_CELLS[0]!.glyph.road} label={t('terrain.brush')} commandId="tool.brush"
          active={!erasing} centre={toolPillCentre(0, erasing ? 1 : 0)}
          onSelect={() => setTool(allowed.includes(brushShape) ? brushShape : allowed[0]!)} />
        {allowed.includes('eraser') && <ToolPill glyph={TOOL_CELLS[1]!.glyph.road} label={t('design.eraser')} commandId="tool.eraser"
          active={erasing} centre={toolPillCentre(1, erasing ? 1 : 0)} onSelect={() => setTool('eraser')} />}
      </div>
      <ToolOptions mode={erasing ? 'erase' : 'draw'}>
        {!erasing && <ShapeOptions value={shape === 'brush' ? 'free' : shape} shapes={shapes}
          onChange={next => setTool(next === 'free' ? 'brush' : next)} />}
        <DimensionsToggle value={dimensions} onChange={setDimensions} />
      </ToolOptions>
      <span style={{ display: 'flex', alignItems: 'center', gap: QUAD.gap, marginLeft: 22 - QUAD.gap }}>
        <Action label={t('generate.clear')} onPress={clearRegionSelection} />
        <Action label={tooSmall ? t('gen.scope_min', { n: minSide ?? 0 }) : t('gen.scope_done')}
          primary disabled={tooSmall} onPress={onDone} />
      </span>
      <AnimatePresence initial={false}>
        {sized && <BrushSizeControl key="size" value={size} onChange={setSize} />}
      </AnimatePresence>
    </ToolRow>
  </div>;
}
