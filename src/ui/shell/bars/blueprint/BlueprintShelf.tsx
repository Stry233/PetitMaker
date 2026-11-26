/**
 * The Blueprint mode's shelf: the bar the sixth mode-row tile opens, drawn for the window's shape. On a
 * wide window the strip and the explorer it unfolds into stand on one band in one root, whose pieces
 * travel between the two (`primitives/morph.ts:morphScope`); upright the panel unfolds by its handle
 * (`UprightBlueprintPanel.tsx`).
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { easingCss, seconds } from '../../../design/motion';
import { clientPoint } from '../../../../platform/device/viewport-space';
import { useTouchMode } from '../../../design/input-mode';
import { useUiPreview } from '../../../design/preview';
import { ScaleProvider } from '../../../design/scale';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { helpTargetAttr } from '../../../session/help-targets';
import { morphScope, type MorphFirst } from '../../../primitives/morph';
import { MorphOnChange } from '../../../primitives/MorphOnChange';
import { useFrameLayout } from '../../frame-layout';
import { SHELF_SCALE } from '../../units';
import { PanelTone, useBarSurface } from '../bar-panel';
import { ShelfBand } from '../ShelfBand';
import { BlueprintExplorer, ExplorerKept, explorerViewIn, PULL } from './BlueprintExplorer';
import { BlueprintRow } from './BlueprintRow';
import { CarriedCard } from './BlueprintCard';
import { BLUEPRINT_SHELF_ATTR } from './use-blueprint-carry';
import { useFrameZoom } from '../../use-frame-zoom';
import { UprightBlueprintPanel } from './UprightBlueprintPanel';
import { useBandGuide, useBlueprintShelf, useShelfChange, type BlueprintShelfModel, type ShelfChange } from './use-blueprint-shelf';
import { LibraryAsksProvider, useLibraryAsks } from './blueprint-asks';

/** The shelf under its own scale; the shapes read `usePx` for their own measurements, so the scale wraps them. */
export function BlueprintShelf() {
  return (
    <ScaleProvider value={SHELF_SCALE}>
      <BlueprintShelfBody />
    </ScaleProvider>
  );
}

/** One model, drawn as the upright panel or as the wide band; only the shape showing runs its hooks. */
function BlueprintShelfBody() {
  const model = useBlueprintShelf();
  const { asks, node } = useLibraryAsks(model);
  return (
    <LibraryAsksProvider value={asks}>
      {useFrameLayout()?.shape === 'portrait' ? <UprightBlueprintPanel model={model} /> : <WideBlueprintShelf model={model} />}
      <CarriedCopyOf model={model} />
      {node}
    </LibraryAsksProvider>
  );
}

/** The copy of the carried card following the pointer over the shelf, shrinking over a folder or the
 *  delete target. */
function CarriedCopyOf({ model }: { model: BlueprintShelfModel }) {
  const zoom = useFrameZoom();
  const { copy, copyRef, dropFolder, overBin } = model.carry;
  const recordOf = (id: string) => model.records.find((r) => r.id === id);
  const record = copy ? recordOf(copy.of.id) : undefined;
  return copy && record ? (
    <CarriedCard record={record} recordOf={recordOf} lifted={model.lifted} copy={copy.of} at={copy.at} copyRef={copyRef} zoom={zoom}
      dropping={dropFolder !== null || overBin} />
  ) : null;
}

/** Under touch, a finger pulling the strip's band up unfolds it. */
function useBandPull(on: boolean, unfold: () => void) {
  const grab = useRef<{ id: number; y: number } | null>(null);
  if (!on) return undefined;
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLSpanElement>) => {
      grab.current = { id: e.pointerId, y: clientPoint(e).y };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLSpanElement>) => {
      const g = grab.current;
      if (!g || g.id !== e.pointerId) return;
      const dy = clientPoint(e).y - g.y;
      if (dy <= -PULL) { grab.current = null; unfold(); }
    },
    onPointerUp: () => { grab.current = null; },
    onPointerCancel: () => { grab.current = null; },
  };
}

/** The band, found in the shelf's root by its piece of the chrome's morph. */
const BAND = '[data-morph="bar-band"]';

/** The band's shape as its layout draws it, as one keyframe: the strip's rounded plate and the
 *  explorer's window-wide panel differ in every edge and corner, which it glides between itself
 *  rather than being scaled, which would stretch its corners. */
function bandShape(el: HTMLElement): Keyframe {
  const cs = getComputedStyle(el);
  return {
    left: cs.left, right: cs.right, bottom: cs.bottom, height: cs.height,
    borderTopLeftRadius: cs.borderTopLeftRadius, borderTopRightRadius: cs.borderTopRightRadius,
    borderBottomLeftRadius: cs.borderBottomLeftRadius, borderBottomRightRadius: cs.borderBottomRightRadius,
  };
}

/**
 * The wide shelf: a root standing over the whole window, open to the map, so the pieces' frame stays
 * put as the band grows from the strip's height to the explorer's; the band takes the upright bar's
 * shape window wide when unfolded, up to the column's top (`FrameLayout.bar.unfold`); the shell
 * raises the frame over the column meanwhile (`Shell.tsx`).
 */
function WideBlueprintShelf({ model }: { model: BlueprintShelfModel }) {
  const surface = useBarSurface('dark', { padRoot: false });
  const layout = useFrameLayout();
  const touch = useTouchMode();
  const reduced = useReducedMotionConfig() === true;
  const preview = useUiPreview();
  const still = reduced || preview;
  const [morph] = useState(() => morphScope({ lift: true }));
  useEffect(() => () => morph.stop(), [morph]);
  const guide = useBandGuide();
  const unfoldH = layout?.bar.unfold ?? surface.bar.height;
  // The layer stack the column opened would stand over the explorer that covers the column.
  const setLayerMode = layout?.setLayerMode;
  useEffect(() => { if (model.unfolded) setLayerMode?.('pill'); }, [model.unfolded, setLayerMode]);
  const pull = useBandPull(touch && !model.unfolded, () => model.unfold(true));
  const { ref } = surface.root;
  /** The band as it stood before the commit that folds or unfolds it. */
  const bandWas = useRef<Keyframe | null>(null);
  const band = () => ref.current?.querySelector<HTMLElement>(BAND) ?? null;
  const shelfChange = useShelfChange(model);
  const changing = useRef<ShelfChange>('unfold');
  const measure = (): MorphFirst | null => {
    if (still || !ref.current) return null;
    changing.current = shelfChange.changing();
    if (changing.current === 'arrange') {
      bandWas.current = null;
      const view = explorerViewIn(ref.current);
      return view ? morph.measure(view) : null;
    }
    const el = band();
    bandWas.current = el ? bandShape(el) : null;
    return morph.measure(ref.current);
  };
  const play = (first: MorphFirst) => {
    if (changing.current === 'arrange') { morph.play(first, 'blueprint.library.arrange'); return; }
    morph.play(first, 'blueprint.library.unfold');
    const el = band(), was = bandWas.current;
    if (!el || !was) return;
    // Held at its old shape through the frame the morph holds its pieces, then set off with them.
    const grow = el.animate([was, bandShape(el)], { duration: seconds('blueprint.library.unfold') * 1000, easing: easingCss('blueprint.library.unfold') });
    grow.pause();
    requestAnimationFrame(() => { if (grow.playState === 'paused') grow.play(); });
  };
  return (
    <motion.div {...helpTargetAttr('blueprint')} {...surface.root} {...{ [BLUEPRINT_SHELF_ATTR]: '' }} style={{
      ...surface.root.style, top: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }}>
      <PanelTone tone={surface.tone}>
        <MorphOnChange<MorphFirst>
          change={shelfChange.change}
          measure={measure}
          play={play}
        >
          <div {...mapEdgeAttr('bottom')} style={{ position: 'relative', display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <ShelfBand tone="dark" morph="bar-band" upright={model.unfolded} piece={guide}
                {...(model.unfolded ? { height: unfoldH } : {})} {...(pull ? { pull } : {})} />
              {model.unfolded || model.carry.keepsExplorer || model.warm ? (
                <ExplorerKept hidden={!model.unfolded}><BlueprintExplorer model={model} surface={surface} height={unfoldH} /></ExplorerKept>
              ) : null}
              {model.unfolded ? null : <BlueprintRow model={model} surface={surface} />}
            </div>
        </MorphOnChange>
      </PanelTone>
    </motion.div>
  );
}
