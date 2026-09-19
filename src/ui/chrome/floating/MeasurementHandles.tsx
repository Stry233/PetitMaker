import { helpTargetAttr } from '../modals/help/targets';
import { useRef, type PointerEvent } from 'react';
import { getActiveView } from '../../../canvas/active-view';
import { resizeMeasurement } from '../../../core/model/annotation-dimensions';
import type { MeasureNote } from '../../../core/model/annotations';
import { clientPoint } from '../../../core/runtime/viewport-space';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { colors, cursors, shadows, z } from '../../design/styles';

/** The parent reprojects on camera, terrain, view and annotation changes. */
export function MeasurementHandles({ note }: { note: MeasureNote }) {
  const t = useT();
  const grab = useRef<{ pointer: number; endpoint: 0 | 1; original: MeasureNote; expected: MeasureNote; began: boolean; offset: { x: number; y: number } } | null>(null);
  const projection = getActiveView()?.projection;
  if (!projection) return null;
  const anchors = note.points.map(p => projection.cellToScreen(p.x, p.y));
  const dx = anchors[1]!.x - anchors[0]!.x, dy = anchors[1]!.y - anchors[0]!.y;
  const distance = Math.hypot(dx, dy);
  const spread = Math.max(0, (40 - distance) / 2);
  const handles = anchors.map((p, i) => ({ ...p,
    x: p.x + (i ? 1 : -1) * spread * (distance ? dx / distance : 1),
    y: p.y + (i ? 1 : -1) * spread * (distance ? dy / distance : 0),
  }));
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const g = grab.current;
    const s = useEditorStore.getState();
    const current = s.gridState?.annotations?.items.find(n => n.id === note.id);
    if (!g || g.pointer !== event.pointerId) return;
    if (current !== g.expected || !s.annotationSelection.includes(note.id) || s.gridState?.annotations?.locked) {
      grab.current = null;
      return;
    }
    const proj = getActiveView()?.projection;
    if (!proj || !s.gridState) return;
    const p = clientPoint(event);
    const cell = proj.screenToHalf?.(p.x - g.offset.x, p.y - g.offset.y) ?? proj.screenToMacro(p.x - g.offset.x, p.y - g.offset.y);
    if (!Number.isFinite(cell.x) || !Number.isFinite(cell.y)) return;
    const points = resizeMeasurement(g.original.points, g.endpoint, {
      x: Math.max(0, Math.min(s.gridState.template.width - 1, cell.x)),
      y: Math.max(0, Math.min(s.gridState.template.height - 1, cell.y)),
    });
    if (s.setMeasurementPoints(note.id, points, !g.began)) {
      g.began = true;
      g.expected = useEditorStore.getState().gridState!.annotations!.items.find(n => n.id === note.id) as MeasureNote;
    }
  };
  return <>
    {spread > 0 && anchors.every(p => !p.behind) && <svg aria-hidden style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: z.canvasControls }}>
      {anchors.map((p, i) => <line key={i} x1={p.x} y1={p.y} x2={handles[i]!.x} y2={handles[i]!.y} stroke={colors.frameDark} strokeWidth={2} />)}
    </svg>}
    {note.points.map((p, index) => {
    const at = handles[index]!;
    if (at.behind) return null;
    return <button key={index} type="button" aria-label={t('annot.endpoint', { n: index + 1 })}
      {...helpTargetAttr('notes', 'notes-measure')} data-measure-endpoint={index}
      onPointerDown={event => {
        if (event.button !== 0 || grab.current) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const pointer = clientPoint(event);
        grab.current = { pointer: event.pointerId, endpoint: index as 0 | 1, original: note, expected: note, began: false,
          offset: { x: pointer.x - anchors[index]!.x, y: pointer.y - anchors[index]!.y } };
      }}
      onPointerMove={move}
      onPointerUp={event => { move(event); grab.current = null; }}
      onPointerCancel={() => { grab.current = null; }}
      onLostPointerCapture={() => { grab.current = null; }}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!delta) return;
        event.preventDefault(); event.stopPropagation();
        const s = useEditorStore.getState();
        const grid = s.gridState;
        if (!grid) return;
        const points = resizeMeasurement(note.points, index as 0 | 1, {
          x: Math.max(0, Math.min(grid.template.width - 1, p.x + delta[0]!)),
          y: Math.max(0, Math.min(grid.template.height - 1, p.y + delta[1]!)),
        });
        s.setMeasurementPoints(note.id, points, true);
      }}
      style={{ position: 'fixed', left: at.x - 18, top: at.y - 18, width: 36, height: 36,
        zIndex: z.canvasControls, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, border: 0, background: 'transparent', borderRadius: '50%', touchAction: 'none', cursor: cursors.clickable }}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: colors.tileYellow,
        border: `2px solid ${colors.frameDark}`, boxShadow: shadows.float, pointerEvents: 'none' }} />
    </button>;
  })}</>;
}
