/** The interface size slider, which mirrors the keyboard's zoom keys. */
import { cssMotion, framerMotion } from '../../../design/motion';
import { ActionButton } from '../../../primitives/ActionButton';
import { clientPoint } from '../../../../platform/device/viewport-space';
import { useState, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { font, radii, cursors, shadows } from '../../../design/styles';
import { inkTint } from '../../../design/tokens';
import { skin } from '../../../design/window-skin';
import { roleFont, TEXT_ROLES } from '../../../design/text-weight';
import { reachableUiZoom, UI_ZOOM_MIN, useDockRef, useFitFloor, useReadableWeight, useViewportSize } from '../../../design/scale';
import { useEditorStore } from '../../../../state/store';
import { helpTargetAttr } from '../../../session/help-targets';
import { visualRect } from '../../../design/visual-rect';

// UI-scale slider bounds — mirror the Ctrl+(+/−) shortcut exactly: the store's
// setUiZoom clamps to [0.6, 1.8] and the shortcut bumps by 0.1, so this slider
// shares the same clamps/step (there is only one persistence path — setUiZoom).
export const UI_SCALE_MIN = UI_ZOOM_MIN;
export const UI_SCALE_STEP = 0.1;
export const roundStep = (z: number) => Math.round(z / UI_SCALE_STEP) * UI_SCALE_STEP;

/* The interface size slider: a ticked track between a small and a large A, a live specimen, and a reset
 * chip that keeps its slot. A drag moves only local state and commits on release, since committing
 * re-zooms the slider under the pointer; keys, double-click and the chip commit at once. */
export function UiScaleSlider({ label }: { label: string }) {
  const weightAt = useReadableWeight();
  const uiZoom = useEditorStore((s) => s.uiZoom);
  const setUiZoom = useEditorStore((s) => s.setUiZoom);
  const ref = useRef<HTMLDivElement>(null);
  // While dragging, `dragZoom` holds the un-committed value; null otherwise. `dragRef`
  // mirrors it so `commitDrag` can read the pending value without a stale closure and
  // without calling setUiZoom from inside a setState updater.
  const [dragZoom, setDragZoom] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const [hover, setHover] = useState(false);
  const dragging = dragZoom !== null;
  const setDrag = (v: number) => { dragRef.current = v; setDragZoom(v); };
  // What the knob/fill/bubble/specimen show — the live drag value while dragging, else the store value.
  // The track ends at the last step this window still answers to; the saved preference may lie past it.
  const { w: vw, h: vh } = useViewportSize();
  const reach = reachableUiZoom(vw, vh, useDockRef(), useFitFloor());
  const max = Math.max(UI_SCALE_MIN + UI_SCALE_STEP, roundStep(Math.floor(reach / UI_SCALE_STEP + 1e-6) * UI_SCALE_STEP));
  const shownZoom = dragZoom ?? uiZoom;
  const pct = Math.round(shownZoom * 100);
  const ratio = Math.min(1, (shownZoom - UI_SCALE_MIN) / (max - UI_SCALE_MIN));
  const isDefault = Math.round(uiZoom * 100) === 100;

  const zoomFromClientX = (clientX: number): number => {
    const el = ref.current;
    if (!el) return uiZoom;
    const r = visualRect(el);
    const frac = r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
    return roundStep(UI_SCALE_MIN + frac * (max - UI_SCALE_MIN));
  };
  // Commit the pending drag value to the store on release (idempotent — a no-op if not dragging).
  const commitDrag = () => {
    if (dragRef.current !== null) setUiZoom(dragRef.current);
    dragRef.current = null;
    setDragZoom(null);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(max, uiZoom + UI_SCALE_STEP);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = uiZoom - UI_SCALE_STEP;
    else if (e.key === 'Home') next = UI_SCALE_MIN;
    else if (e.key === 'End') next = max;
    if (next !== null) { e.preventDefault(); setUiZoom(roundStep(next)); }
  };

  // The flanking `A` marks are the ladder's own ends: the smallest rank on one side of the track,
  // the title rank on the other, so the sizes come from the inventory like any run of text.
  const flankA = (role: 'caption' | 'title'): CSSProperties => ({
    ...roleFont(role),
    fontFamily: font.family,
    color: skin.muted,
    lineHeight: 1,
    flexShrink: 0,
  });

  const tickCount = Math.round((max - UI_SCALE_MIN) / UI_SCALE_STEP) + 1;

  return (
    <div {...helpTargetAttr('settings', 'settings-scale')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={flankA('caption')} aria-hidden>A</span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={Math.round(UI_SCALE_MIN * 100)}
        aria-valuemax={Math.round(max * 100)}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        onKeyDown={onKeyDown}
        onDoubleClick={() => { dragRef.current = null; setDragZoom(null); setUiZoom(1); }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(zoomFromClientX(clientPoint(e).x)); }}
        onPointerMove={(e) => { if (e.buttons) setDrag(zoomFromClientX(clientPoint(e).x)); }}
        onPointerUp={commitDrag}
        onPointerCancel={commitDrag}
        onLostPointerCapture={commitDrag}
        style={{ position: 'relative', flex: 1, height: 34, cursor: cursors.clickable, touchAction: 'none', outline: 'none' }}
     >
        <div style={{ position: 'absolute', top: 8, left: 0, right: 0, height: 10, background: skin.track, borderRadius: radii.pill }} />
        <div style={{ position: 'absolute', top: 8, left: 0, width: `${ratio * 100}%`, height: 10, background: skin.active, borderRadius: radii.pill }} />
        {Array.from({ length: tickCount }, (_, i) => {
          const v = UI_SCALE_MIN + i * UI_SCALE_STEP;
          const mid = Math.round(v * 100) === 100;
          return (
            <span
              key={i}
              style={{
                position: 'absolute',
                top: 22,
                left: `${(i / (tickCount - 1)) * 100}%`,
                width: 1.5,
                height: mid ? 8 : 5,
                background: mid ? skin.muted : skin.track,
                opacity: mid ? 0.55 : 1,
                transform: 'translateX(-50%)',
              }}
            />
          );
        })}
        <div style={{ position: 'absolute', top: 13, left: `${ratio * 100}%`, width: 20, height: 20, transform: 'translate(-50%, -50%)', borderRadius: '50%', background: skin.active, boxShadow: shadows.knob }} />
        {/* Value bubble over the knob: dark fill, white bold %, soft shadow, down-pointing tail.
            Framer x:'-50%' centering, never a CSS transform on the animated element — framer owns
            the transform. Shows on hover or drag. */}
        <AnimatePresence>
          {(hover || dragging) && (
            <motion.div key="bubble"
              initial={{ opacity: 0, scale: 0.6, x: '-50%', y: 4 }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: 0 }}
              exit={{ opacity: 0, scale: 0.6, x: '-50%', y: 4 }}
              transition={framerMotion('surface.arrive')}
              style={{ position: 'absolute', left: `${ratio * 100}%`, bottom: '100%', marginBottom: 8, transformOrigin: 'bottom center', background: skin.ink, color: skin.onDark, fontFamily: font.family, ...roleFont('menu'), lineHeight: 1, padding: '4px 10px', borderRadius: radii.md, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: shadows.float }}>
              {`${pct}%`}
              <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `6px solid ${skin.ink}` }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <span style={flankA('title')} aria-hidden>A</span>
      {/* The live specimen: the letters scale as the interface would. */}
      <div style={{ width: 50, height: 50, borderRadius: radii.md, background: skin.plate, boxShadow: `inset 0 0 0 1px ${inkTint(0.10)}`, display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }} aria-hidden>
        <span style={{ ...roleFont('label'), fontWeight: weightAt(TEXT_ROLES.label.weight, TEXT_ROLES.label.px * shownZoom), fontFamily: font.family, color: skin.ink, transition: cssMotion('control.paint', ['transform']), transform: `scale(${shownZoom})` }}>Aa</span>
      </div>
      {/* ↺ keeps its slot when hidden so appearing never shifts the row; aria-hidden takes it out
          of the accessibility tree at 100%, where there is nothing to reset. */}
      <ActionButton interaction="tile"
        type="button"
        aria-label={`${label} 100%`}
        aria-hidden={isDefault}
        tabIndex={isDefault ? -1 : 0}
        style={{
          width: 32, height: 32, borderRadius: radii.pill, border: 'none',
          background: skin.inset, color: skin.plateInk, fontFamily: font.family,
          ...roleFont('chip'), display: 'grid', placeItems: 'center', flexShrink: 0,
          cursor: cursors.clickable,
          opacity: isDefault ? 0 : 1, pointerEvents: isDefault ? 'none' : 'auto',
          transition: cssMotion('control.paint', ['opacity']),
        }}
        onClick={() => setUiZoom(1)}
     >
        {'↺'}
      </ActionButton>
    </div>
  );
}
