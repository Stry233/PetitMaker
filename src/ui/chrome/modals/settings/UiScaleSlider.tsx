/** The interface size slider, which mirrors the keyboard's zoom keys. */
import { cssMotion } from '../../../design/motion';
import { ActionButton } from '../../../primitives/ActionButton';
import { useState, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { font, radii, cursors } from '../../../design/styles';
import { inkTint } from '../../../design/tokens';
import { skin } from '../../../design/window-skin';
import { roleFont, TEXT_ROLES } from '../../../design/text-weight';
import { useReadableWeight, useScaleReach } from '../../../design/scale';
import { pressCommand } from '../../../../editor/commands/run';
import { useEditorStore } from '../../../../state/store';
import { helpTargetAttr } from '../../../session/help-targets';
import { useCurrentInputMode, useLayoutShape } from '../../../design/input-mode';
import { UI_SCALE_STEP, UI_ZOOM_DEFAULTS, scaleLattice, scaleProfileOf, uiZoomStep } from '../../../../platform/storage/facts';
import { StepSlider } from '../../../primitives/StepSlider';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { ResetIcon } from '../../../primitives/line-glyphs';

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
  const setUiZoom = (value: number) => pressCommand('settings.interface_zoom', { value });
  // While dragging, `dragZoom` holds the un-committed value; null otherwise. `dragRef`
  // mirrors it so `commitDrag` can read the pending value without a stale closure and
  // without calling setUiZoom from inside a setState updater.
  const [dragZoom, setDragZoom] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const setDrag = (v: number) => { dragRef.current = v; setDragZoom(v); };
  // What the knob/fill/bubble/specimen show — the live drag value while dragging, else the store value.
  // The track ends at the last step this window still answers to; the saved preference may lie past it.
  const reach = useScaleReach();
  const fallback = UI_ZOOM_DEFAULTS[scaleProfileOf(useCurrentInputMode(), useLayoutShape())];
  const { lo: min, hi: max, snap } = scaleLattice(fallback, reach);
  const shownZoom = dragZoom ?? uiZoom;
  const pct = Math.round(shownZoom * 100);
  const isDefault = Math.round(uiZoom * 100) === Math.round(fallback * 100);

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
    const steps = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (steps !== 0) {
      e.preventDefault();
      const next = uiZoomStep(live, reach, steps);
      if (next !== null) setUiZoom(next);
      return;
    }
    if (e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const lattice = scaleLattice(UI_ZOOM_DEFAULTS[scaleProfileOf(live.inputMode, live.layoutShape)], reach);
    setUiZoom(e.key === 'Home' ? lattice.lo : lattice.hi);
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
      <StepSlider label={label} stops={tickCount} value={Math.round((shownZoom - min) / UI_SCALE_STEP)} valueText={`${pct}%`}
        mark={Math.round((fallback - min) / UI_SCALE_STEP)} aria={{ min: Math.round(min * 100), max: Math.round(max * 100), now: pct }}
        onPick={(stop) => setDrag(snap(min + stop * UI_SCALE_STEP))} onRelease={commitDrag} onKeyDown={onKeyDown}
        onDoubleClick={() => { dragRef.current = null; setDragZoom(null); setUiZoom(fallback); }} />
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
