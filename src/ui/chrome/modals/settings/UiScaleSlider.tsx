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
import { scaleLattice, UI_SCALE_STEP, useReadableWeight, useScaleReach } from '../../../design/scale';
import { useEditorStore } from '../../../../state/store';
import { helpTargetAttr } from '../../../session/help-targets';
import { visualRect } from '../../../design/visual-rect';
import { useSliderGlide } from '../../../primitives/use-slider-glide';
import { useCurrentInputMode, useLayoutShape } from '../../../design/input-mode';
import { UI_ZOOM_DEFAULTS, scaleProfileOf } from '../../../../platform/storage/prefs';
import { TouchReach } from '../../../primitives/TouchReach';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { ResetIcon } from '../../../primitives/line-glyphs';

/** The track's height, in the window's px. */
const TRACK_H = 34;
/** The least track length one row may leave before the slider takes a row of its own, in the window's px. */
const TRACK_MIN = 96;
/** What the one-row arrangement spends beside the track: both A marks, the specimen, the reset chip and the gaps. */
const ROW_BESIDE_TRACK = 190;

/* The interface size slider: a ticked track between a small and a large A, a live specimen, and a reset
 * chip that always stands. A drag moves only local state and commits on release, since committing
 * re-zooms the slider under the pointer; keys, double-click and the chip commit at once. It edits the
 * scale of the input mode in force, whose default the long tick marks and the chip restores. */
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
  const reach = useScaleReach();
  const fallback = UI_ZOOM_DEFAULTS[scaleProfileOf(useCurrentInputMode(), useLayoutShape())];
  const { lo: min, hi: max, snap } = scaleLattice(fallback, reach);
  const shownZoom = dragZoom ?? uiZoom;
  const pct = Math.round(shownZoom * 100);
  const ratio = Math.min(1, Math.max(0, (shownZoom - min) / (max - min)));
  // The knob, fill and reading glide to the shown value; a drag still commits only on release.
  const glide = useSliderGlide(ratio);
  const isDefault = Math.round(uiZoom * 100) === Math.round(fallback * 100);

  const zoomFromClientX = (clientX: number): number => {
    const el = ref.current;
    if (!el) return uiZoom;
    const r = visualRect(el);
    const frac = r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
    return snap(min + frac * (max - min));
  };
  // Commit the pending drag value to the store on release (idempotent — a no-op if not dragging).
  const commitDrag = () => {
    if (dragRef.current !== null) setUiZoom(dragRef.current);
    dragRef.current = null;
    setDragZoom(null);
  };
  // A key press can switch the input mode on its way down (the window hears it first), so the
  // step reads the mode and scale in force now, not this render's.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const live = useEditorStore.getState();
    const lattice = scaleLattice(UI_ZOOM_DEFAULTS[scaleProfileOf(live.inputMode, live.layoutShape)], reach);
    const now = lattice.snap(live.uiZoom);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = now + UI_SCALE_STEP;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = now - UI_SCALE_STEP;
    else if (e.key === 'Home') next = lattice.lo;
    else if (e.key === 'End') next = lattice.hi;
    if (next !== null) { e.preventDefault(); setUiZoom(lattice.snap(next)); }
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

  const tickCount = Math.round((max - min) / UI_SCALE_STEP) + 1;
  // Where one row leaves the track too short to use, the slider takes a row of its own and the specimen
  // widens under it beside the reset chip, its sample running longer. Read from the group's width, which
  // the choice does not change.
  const group = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useObservedSize(() => group.current, ([el]) => { if (el) setWidth(el.clientWidth); }, []);
  const stacked = width > 0 && width - ROW_BESIDE_TRACK < TRACK_MIN;

  const track = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
      <span style={flankA('caption')} aria-hidden>A</span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={Math.round(min * 100)}
        aria-valuemax={Math.round(max * 100)}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        onKeyDown={onKeyDown}
        onDoubleClick={() => { dragRef.current = null; setDragZoom(null); setUiZoom(fallback); }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(zoomFromClientX(clientPoint(e).x)); }}
        onPointerMove={(e) => { if (e.buttons) setDrag(zoomFromClientX(clientPoint(e).x)); }}
        onPointerUp={commitDrag}
        onPointerCancel={commitDrag}
        onLostPointerCapture={commitDrag}
        style={{ position: 'relative', flex: 1, height: TRACK_H, cursor: cursors.clickable, touchAction: 'none', outline: 'none' }}
     >
        <TouchReach h={TRACK_H} sides={{ left: false, right: false }} />
        <div style={{ position: 'absolute', top: 8, left: 0, right: 0, height: 10, background: skin.track, borderRadius: radii.pill }} />
        <motion.div style={{ position: 'absolute', top: 8, left: 0, width: glide.percent, height: 10, background: skin.active, borderRadius: radii.pill }} />
        {Array.from({ length: tickCount }, (_, i) => {
          const v = min + i * UI_SCALE_STEP;
          const mid = Math.round(v * 100) === Math.round(fallback * 100);
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
        <motion.div style={{ position: 'absolute', top: 13, left: glide.percent, width: 20, height: 20, x: '-50%', y: '-50%', borderRadius: '50%', background: skin.active, boxShadow: shadows.knob }} />
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
              style={{ position: 'absolute', left: glide.percent, bottom: '100%', marginBottom: 8, transformOrigin: 'bottom center', background: skin.ink, color: skin.onDark, fontFamily: font.family, ...roleFont('menu'), lineHeight: 1, padding: '4px 10px', borderRadius: radii.md, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: shadows.float }}>
              {`${pct}%`}
              <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `6px solid ${skin.ink}` }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <span style={flankA('title')} aria-hidden>A</span>
    </div>
  );
  return (
    <div ref={group} {...helpTargetAttr('settings', 'settings-scale')}
      style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center', gap: 12 }}>
      {track}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
      {/* The live specimen: the letters scale as the interface would. It takes the room the row leaves. */}
      <div style={{ ...(stacked ? { flexGrow: 1, flexBasis: '0%' } : { width: 50 }), height: 50, borderRadius: radii.md, background: skin.plate, boxShadow: `inset 0 0 0 1px ${inkTint(0.10)}`, display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }} aria-hidden>
        <span style={{ ...roleFont('label'), fontWeight: weightAt(TEXT_ROLES.label.weight, TEXT_ROLES.label.px * shownZoom), fontFamily: font.family, color: skin.ink, transition: cssMotion('control.paint', ['transform']), transform: `scale(${shownZoom})` }}>{stacked ? 'AaBbCc' : 'Aa'}</span>
      </div>
      {/* The reset stands at all times, dimmed and refusing at the mode's default where there is nothing to reset. */}
      <ActionButton interaction="tile"
        type="button"
        aria-label={`${label} ${Math.round(fallback * 100)}%`}
        unavailable={isDefault}
        style={{
          width: 32, height: 32, borderRadius: radii.pill, border: 'none',
          background: skin.inset, color: skin.plateInk, fontFamily: font.family,
          ...roleFont('chip'), display: 'grid', placeItems: 'center', flexShrink: 0,
          ...(isDefault ? {} : { cursor: cursors.clickable }),
          transition: cssMotion('control.paint', ['opacity']),
        }}
        onClick={() => setUiZoom(fallback)}
     >
        <ResetIcon size={18} />
      </ActionButton>
      </div>
    </div>
  );
}
