import { helpTargetAttr } from '../../session/help-targets';
import { getActiveView } from '../../../view/active-view';
import { measureEndDrag, nudgeMeasureEnd, type MeasureEndDrag } from '../../../editor/editing/annotation-edit';
import { noteStepCell, zoneCellCentre, type MeasureNote } from '../../../core/model/annotations';
import { clientPoint } from '../../../platform/device/viewport-space';
import { useT } from '../../../i18n/context';
import { cursors, shadows, z } from '../../design/styles';
import { FRAME_INK, ACTIVE } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { useWindowDrag } from '../../primitives/use-window-drag';

/** What a press on an end took hold of: its drag, and where on the handle the pointer landed. */
interface EndGrab { drag: MeasureEndDrag; offset: { x: number; y: number } }

/** The parent reprojects on camera, terrain, view and annotation changes. */
export function MeasurementHandles({ note }: { note: MeasureNote }) {
  const t = useT();
  /** Follows the pointer to a cell; false once the drag refuses one, which ends it. */
  const follow = (e: PointerEvent, g: EndGrab): boolean => {
    const proj = getActiveView()?.projection;
    if (!proj) return true;
    const p = clientPoint(e);
    const cell = noteStepCell(proj.screenToPoint(p.x - g.offset.x, p.y - g.offset.y));
    if (!Number.isFinite(cell.x) || !Number.isFinite(cell.y)) return true;
    return g.drag.to(cell);
  };
  const grab = useWindowDrag<EndGrab>({
    move: (e, g) => { if (!follow(e, g)) grab.stop(); },
    end: (e, g) => { if (follow(e, g)) g.drag.end(); },
    cancel: (_, g) => g.drag.end(),
  });
  const projection = getActiveView()?.projection;
  if (!projection) return null;
  const anchors = note.points.map(p => { const c = zoneCellCentre(p); return projection.cellToScreen(c.x, c.y); });
  const dx = anchors[1]!.x - anchors[0]!.x, dy = anchors[1]!.y - anchors[0]!.y;
  const distance = Math.hypot(dx, dy);
  const spread = Math.max(0, (40 - distance) / 2);
  const handles = anchors.map((p, i) => ({ ...p,
    x: p.x + (i ? 1 : -1) * spread * (distance ? dx / distance : 1),
    y: p.y + (i ? 1 : -1) * spread * (distance ? dy / distance : 0),
  }));
  return <>
    {spread > 0 && anchors.every(p => !p.behind) && <svg aria-hidden style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: z.canvasControls }}>
      {anchors.map((p, i) => <line key={i} x1={p.x} y1={p.y} x2={handles[i]!.x} y2={handles[i]!.y} stroke={FRAME_INK} strokeWidth={2} />)}
    </svg>}
    {note.points.map((_, index) => {
    const at = handles[index]!;
    if (at.behind) return null;
    return <ActionButton key={index} interaction="tile" aria-label={t('annot.endpoint', { n: index + 1 })}
      {...helpTargetAttr('notes', 'notes-measure')} data-measure-endpoint={index}
      onPointerDown={event => {
        if (event.button !== 0 || grab.held()) return;
        event.preventDefault(); event.stopPropagation();
        const drag = measureEndDrag(note.id, index as 0 | 1);
        if (!drag) return;
        const pointer = clientPoint(event);
        grab.start(event, { drag, offset: { x: pointer.x - anchors[index]!.x, y: pointer.y - anchors[index]!.y } });
      }}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!delta) return;
        event.preventDefault(); event.stopPropagation();
        nudgeMeasureEnd(note.id, index as 0 | 1, delta[0]!, delta[1]!);
      }}
      style={{ position: 'fixed', left: at.x - 18, top: at.y - 18, width: 36, height: 36,
        zIndex: z.canvasControls, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, border: 0, background: 'transparent', borderRadius: '50%', touchAction: 'none', cursor: cursors.clickable }}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: ACTIVE,
        border: `2px solid ${FRAME_INK}`, boxShadow: shadows.float, pointerEvents: 'none' }} />
    </ActionButton>;
  })}</>;
}
