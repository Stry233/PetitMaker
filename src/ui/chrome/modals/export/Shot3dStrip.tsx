import { framerMotion } from '../../../design/motion';
import { ActionButton } from '../../../primitives/ActionButton';
import { useNameReveal } from '../../../primitives/use-name-reveal';
import { font, radii, cursors } from '../../../design/styles';
import { inkTint } from '../../../design/tokens';
// The export's 3D shots: a row of 1 to 5 thumbnail blocks sharing the row's width, plus an Add tile.
// A block opens Preview3D in edit mode and its corner cross deletes it (one always remains). Where an
// equal share is narrower than a full card frame, the hovered tile grows to that frame and the others
// give way; width and margin are the only animated properties, so adds, deletes and hovers share one motion.
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { motion, AnimatePresence, type HTMLMotionProps } from 'framer-motion';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { Spinner } from '../../../primitives/Spinner';
import { seedShots, addShot, deleteShot, MAX_SHOTS, MIN_SHOTS } from '../../../../view/map3d/capture/shot-list';
import type { CameraAngle } from '../../../../state/view-camera';
import { CARD_3D_CELL_ASPECT } from '../../../../io/export/facts';
import { useShot3dThumbs } from './use-shot-thumbs';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useObjectKey } from '../../../primitives/use-object-key';
import { useHover, useInteractionProfiles, useTouchMode } from '../../../design/input-mode';
import { useReveal, withBind } from '../../../primitives/use-reveal';
import { TouchReach } from '../../../primitives/TouchReach';
import { useSurfaceZoom } from '../../../design/scale';

const H = 62;                                        // row height (fixed)
// A tile's full, expanded width uses the same aspect as a cell in the exported 3D card, so a
// hovered thumbnail previews the exact frame shape the export will produce.
const FULL_W = Math.round(H * CARD_3D_CELL_ASPECT);
const GAP = 8;
const ADD_W = 40;      // Add tile's resting width
const MIN_W = 24;
const RADIUS = radii.md;

/** The delete badge's side, in the window's px. */
const DEL = 18;

export function Shot3dStrip({ open }: { open: boolean }) {
  const t = useT();
  const addName = useNameReveal(t('export.shot_add'));
  const profiles = useInteractionProfiles();
  const chrome = useSurfaceZoom();
  const gridState = useEditorStore((s) => s.gridState);
  const shots = useEditorStore((s) => s.export3dShots);
  const setShots = useEditorStore((s) => s.setExport3dShots);
  const setEdit = useEditorStore((s) => s.setPreview3DEdit);
  const setModal = useEditorStore((s) => s.setModal);
  const setPreviewOpen = (open: boolean) => setModal('preview3d', open);
  // A key per shot angle object, so add and delete keep sibling keys: a delete keeps the same
  // objects, an add or replace mints new ones.
  const shotKey = useObjectKey<CameraAngle>();

  const wrapRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null); // block index, or `n` for the + tile
  // Nothing hovers in touch mode: no tile grows, and every block wears its delete square.
  const touch = useTouchMode();
  const reached = useHover(hovered) ?? null;
  // The strip keeps the last block reached until the pointer leaves the strip, so crossing a gap
  // does not fold the widened block under it.
  // A hold only widens, so the press still lands.
  const stripReach = useReveal({ keepsClick: true, onChange: (shown) => { if (!shown) setHovered(null); } }).bind;
  const addReach = useReveal({ keepsClick: true, onChange: (shown) => { if (shown && n < MAX_SHOTS) setHovered(n); } }).bind;

  // Seed the shot set the first time the 3D toggle is enabled (or after a reset left it empty).
  useEffect(() => {
    if (open && gridState && shots.length === 0) setShots(seedShots(gridState));
  }, [open, gridState, shots.length, setShots]);

  // Measure the row so each block can take an equal share of the width (fills the row).
  useObservedSize(() => wrapRef.current, ([el]) => setAvailW(el!.clientWidth), [open], { layout: false });

  const { urls, loading } = useShot3dThumbs(shots, gridState ?? null, open);

  const n = shots.length;
  const addVisible = n < MAX_SHOTS;
  const gaps = addVisible ? n : Math.max(0, n - 1); // GAP-sized gaps between visible tiles
  const equalW = n > 0 ? (availW - (addVisible ? ADD_W : 0) - gaps * GAP) / n : MIN_W;
  // If the even share is already as wide as a full card frame there's nothing to reveal, so the
  // hover-expand only kicks in when it's narrower than that.
  const cramped = availW > 0 && equalW < FULL_W;
  const gapAfter = (i: number) => (i < n - 1 || addVisible ? GAP : 0);

  // Resolve every tile's target width. Default = even fill. When cramped and a tile is hovered, it
  // grows to a full card frame (FULL_W) and the rest reduce further to share what's left of the row.
  let addW = ADD_W;
  const blockWs = new Array<number>(n).fill(Math.max(MIN_W, equalW));
  if (cramped && reached !== null) {
    if (reached < n) {
      const rest = availW - FULL_W - (addVisible ? ADD_W : 0) - gaps * GAP;
      const each = n > 1 ? Math.max(MIN_W, rest / (n - 1)) : FULL_W;
      for (let i = 0; i < n; i++) blockWs[i] = i === reached ? FULL_W : each;
    } else if (addVisible) {
      // The + only needs to grow to a square at most (it's a button, not a preview frame).
      addW = H;
      const rest = availW - H - gaps * GAP;
      const each = Math.max(MIN_W, rest / n);
      for (let i = 0; i < n; i++) blockWs[i] = each;
    }
  }

  const editShot = (i: number) => {
    const angle = shots[i];
    if (!angle) return;
    setEdit({ index: i, angle });
    setPreviewOpen(true);
  };

  // ✕ only on a full-ish block (always when roomy; when cramped only on the expanded/hovered one),
  // so tiny cropped tiles stay clean, except in touch mode, where no block expands.
  const showDel = (i: number) => n > MIN_SHOTS && (touch || !cramped || reached === i);


  return (
    <div ref={wrapRef} {...stripReach}
      style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', height: H }}>
      <AnimatePresence initial={false}>
        {shots.map((s, i) => {
          const url = urls[i];
          return (
            <ShotBlock key={shotKey(s)} width={blockWs[i]!} gap={gapAfter(i)} onReach={() => setHovered(i)}>
              <NamedShotButton
                label={t('export.shot_edit_hint')} onClick={() => editShot(i)}
                whileTap={profiles.pillTap.whileTap} transition={framerMotion('control.settle')}
                style={{ position: 'absolute', inset: 0, border: 'none', padding: 0, cursor: cursors.clickable, background: 'transparent', WebkitTapHighlightColor: 'transparent' }}
             >
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: skin.muted }}>
                  {loading ? <Spinner size={16} /> : <span aria-hidden style={{ opacity: 0.6, fontSize: 18 }}>◱</span>}
                </span>
                {url && (
                  // object-fit: cover fills the block at any width (rounded corners hug it); the
                  // hovered card-frame shows the full crop, a narrow tile a center slice.
                  <img src={url} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                )}
              </NamedShotButton>
              {showDel(i) && (
                <DeleteBadge label={t('export.shot_delete')} zoom={chrome}
                  onClick={(e) => { e.stopPropagation(); setShots(deleteShot(shots, i)); }} />
              )}
            </ShotBlock>
          );
        })}
        {/* The + tile is always mounted and animates its width to 0 when the max is reached, rather
            than unmounting — unmounting a tile mid-animation was a layout discontinuity that snapped
            the row when the 5th shot hid it. Its dash is the affordance (an empty slot that takes a
            shot), which is why it keeps an edge where the window draws none. */}
        <motion.button
          key="add" type="button" disabled={!addVisible}
          aria-label={addVisible ? t('export.shot_add') : undefined} {...(addVisible && !touch ? addName.bind : {})} aria-hidden={!addVisible}
          initial={false} animate={{ width: addVisible ? addW : 0, opacity: addVisible ? 1 : 0 }}
          transition={framerMotion('export.shot.resize')} whileTap={addVisible ? profiles.thumbnailAdd.whileTap : undefined}
          {...addReach}
          onClick={() => { if (addVisible && gridState) setShots(addShot(shots, gridState)); }}
          style={{ height: H, flex: 'none', borderRadius: RADIUS, border: addVisible ? `1.5px dashed ${skin.line}` : 'none', background: 'transparent', color: skin.muted, fontFamily: font.family, fontWeight: 800, fontSize: 22, lineHeight: 1, overflow: 'hidden', pointerEvents: addVisible ? 'auto' : 'none', WebkitTapHighlightColor: 'transparent' }}
        >
          {/* In touch mode the name rides the tile's face, since the tile's own pointer handlers are the strip's reach. */}
          {touch ? <span {...(addVisible ? addName.bind : {})} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>+</span> : '+'}
          {addName.bubble}
        </motion.button>
      </AnimatePresence>
    </div>
  );
}

/** One shot's block: its width glides on the strip's own clock, and reaching it widens it. */
function ShotBlock({ width, gap, onReach, children }: { width: number; gap: number; onReach: () => void; children: ReactNode }) {
  const reach = useReveal({ keepsClick: true, onChange: (shown) => { if (shown) onReach(); } }).bind;
  return (
    <motion.div
      initial={{ width: 0, marginRight: 0, opacity: 0 }}
      animate={{ width, marginRight: gap, opacity: 1 }}
      exit={{ width: 0, marginRight: 0, opacity: 0 }}
      transition={framerMotion('export.shot.resize')}
      {...reach}
      style={{ position: 'relative', height: H, flex: 'none', borderRadius: RADIUS, overflow: 'hidden', background: skin.inset }}
    >
      {children}
    </motion.div>
  );
}

/** A shot's delete square. */
const delBtn: CSSProperties = {
  position: 'absolute', top: 3, right: 3, width: DEL, height: DEL, borderRadius: '50%', border: 'none',
  background: inkTint(0.66), color: skin.onDark, cursor: cursors.clickable, ...roleFont('small'),
  lineHeight: `${DEL}px`, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
};

/** A shot's picture, which opens it for editing, named by `label` (`useNameReveal`). */
function NamedShotButton({ label, children, ...props }: Omit<HTMLMotionProps<'button'>, 'title' | 'children'> & { label: string; children: ReactNode }) {
  const name = useNameReveal(label);
  return <motion.button type="button" {...withBind(name.bind, props)}>{children}{name.bubble}</motion.button>;
}

/** A shot's delete square, named by `label` (`useNameReveal`). */
function DeleteBadge({ label, zoom, onClick }: { label: string; zoom: number; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  const name = useNameReveal(label);
  return (
    <ActionButton interaction="badge" {...name.bind} aria-label={label} onClick={onClick} style={delBtn}>
      ×
      {/* In the block's corner, so it grows into the block rather than past its clipped edges. */}
      <TouchReach w={DEL} h={DEL} zoom={zoom} sides={{ top: false, right: false }} />
      {name.bubble}
    </ActionButton>
  );
}
