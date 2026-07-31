// Shot3dStrip — the export "3D shots" menu: a single row of rounded thumbnail blocks (1..5) that
// FILL the row width, plus an Add tile. Clicking a block opens the full-screen Preview3D in edit
// mode; the corner ✕ deletes it (min 1).
//
// Sizing: each block takes the measured row's equal share, so N blocks span the whole row. When
// that share is narrower than a full export-card frame (FULL_W) — i.e. there isn't room to show
// every image at full width — hovering a tile grows it to that frame (width only) and the others
// reduce further to keep the row filled; leaving the row restores the even fill. The + tile gets
// the same hover-expand. When the even share is already >= a full frame, hover does nothing.
//
// Animation: width + inter-tile margin are the ONLY animated props (one springs.gentle authority),
// so add/delete AND the hover-expand all ride the same spring — no layout/popLayout, no distortion,
// no reflow jump.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, font, radii, springs, inkTint, cursors } from '../../styles';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Spinner } from '../../Spinner';
import { seedShots, addShot, deleteShot, MAX_SHOTS, MIN_SHOTS } from '../../../canvas/map3d/shot-list';
import type { CameraAngle } from '../../../canvas/map3d/capture';
import { CARD_3D_CELL_ASPECT } from '../../../io/export/paint';
import { useShot3dThumbs } from './use-shot-thumbs';

const H = 62;                                        // row height (fixed)
// A tile's full, expanded width uses the SAME aspect as a cell in the exported 3D card, so a
// hovered thumbnail previews the exact frame shape the export will produce.
const FULL_W = Math.round(H * CARD_3D_CELL_ASPECT);
const GAP = 8;
const ADD_W = 40;      // Add tile's resting width
const MIN_W = 24;
const RADIUS = radii.md;

// Stable identity per shot ANGLE object so add/delete keep sibling keys stable (delete keeps the
// same array refs; add/replace mint new ones → new key). Module-level, WeakMap-keyed.
let _keyCounter = 0;
const _shotKeys = new WeakMap<object, number>();
function shotKey(a: CameraAngle): number {
  let k = _shotKeys.get(a);
  if (k === undefined) { k = ++_keyCounter; _shotKeys.set(a, k); }
  return k;
}

export function Shot3dStrip({ open }: { open: boolean }) {
  const t = useT();
  const gridState = useEditorStore((s) => s.gridState);
  const shots = useEditorStore((s) => s.export3dShots);
  const setShots = useEditorStore((s) => s.setExport3dShots);
  const setEdit = useEditorStore((s) => s.setPreview3DEdit);
  const setModal = useEditorStore((s) => s.setModal);
  const setPreviewOpen = (open: boolean) => setModal('preview3d', open);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null); // block index, or `n` for the + tile

  // Seed the shot set the first time the 3D toggle is enabled (or after a reset left it empty).
  useEffect(() => {
    if (open && gridState && shots.length === 0) setShots(seedShots(gridState));
  }, [open, gridState, shots.length, setShots]);

  // Measure the row so each block can take an equal share of the width (fills the row).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setAvailW(el.clientWidth));
    ro.observe(el);
    setAvailW(el.clientWidth);
    return () => ro.disconnect();
  }, [open]);

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
  if (cramped && hovered !== null) {
    if (hovered < n) {
      const rest = availW - FULL_W - (addVisible ? ADD_W : 0) - gaps * GAP;
      const each = n > 1 ? Math.max(MIN_W, rest / (n - 1)) : FULL_W;
      for (let i = 0; i < n; i++) blockWs[i] = i === hovered ? FULL_W : each;
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
  // so tiny cropped tiles stay clean.
  const showDel = (i: number) => n > MIN_SHOTS && (!cramped || hovered === i);

  const delBtn: CSSProperties = {
    position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', border: 'none',
    background: inkTint(0.66), color: colors.white, cursor: cursors.clickable, fontSize: 12, fontWeight: 900,
    lineHeight: '18px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div ref={wrapRef} onMouseLeave={() => setHovered(null)}
      style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', height: H }}>
      <AnimatePresence initial={false}>
        {shots.map((s, i) => {
          const url = urls[i];
          return (
            <motion.div
              key={shotKey(s)}
              initial={{ width: 0, marginRight: 0, opacity: 0 }}
              animate={{ width: blockWs[i], marginRight: gapAfter(i), opacity: 1 }}
              exit={{ width: 0, marginRight: 0, opacity: 0 }}
              transition={springs.gentle}
              onMouseEnter={() => setHovered(i)}
              style={{ position: 'relative', height: H, flex: 'none', borderRadius: RADIUS, overflow: 'hidden', background: colors.surfaceSecondary }}
            >
              <motion.button
                type="button" title={t('export.shot_edit_hint')} onClick={() => editShot(i)}
                onFocus={() => setHovered(i)} whileTap={{ scale: 0.96 }} transition={springs.stiff}
                style={{ position: 'absolute', inset: 0, border: 'none', padding: 0, cursor: cursors.clickable, background: 'transparent', WebkitTapHighlightColor: 'transparent' }}
              >
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textSecondary }}>
                  {loading ? <Spinner size={16} /> : <span aria-hidden style={{ opacity: 0.6, fontSize: 18 }}>◱</span>}
                </span>
                {url && (
                  // object-fit: cover fills the block at any width (rounded corners hug it); the
                  // hovered card-frame shows the full crop, a narrow tile a center slice.
                  <img src={url} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                )}
              </motion.button>
              {showDel(i) && (
                <button type="button" aria-label={t('export.shot_delete')} title={t('export.shot_delete')}
                  onClick={(e) => { e.stopPropagation(); setShots(deleteShot(shots, i)); }} style={delBtn}>×</button>
              )}
            </motion.div>
          );
        })}
        {/* The + tile is ALWAYS mounted and animates its width to 0 when the max is reached, rather
            than unmounting — unmounting a tile mid-animation was a layout discontinuity that snapped
            the row when the 5th shot hid it. */}
        <motion.button
          key="add" type="button" disabled={!addVisible}
          aria-label={addVisible ? t('export.shot_add') : undefined} title={addVisible ? t('export.shot_add') : undefined} aria-hidden={!addVisible}
          initial={false} animate={{ width: addVisible ? addW : 0, opacity: addVisible ? 1 : 0 }}
          transition={springs.gentle} whileTap={addVisible ? { scale: 0.94 } : undefined}
          onMouseEnter={() => addVisible && setHovered(n)}
          onClick={() => { if (addVisible && gridState) setShots(addShot(shots, gridState)); }}
          style={{ height: H, flex: 'none', borderRadius: RADIUS, border: addVisible ? `1.5px dashed ${inkTint(0.28)}` : 'none', background: 'transparent', color: colors.textSecondary, fontFamily: font.family, fontWeight: 800, fontSize: 22, lineHeight: 1, overflow: 'hidden', pointerEvents: addVisible ? 'auto' : 'none', WebkitTapHighlightColor: 'transparent' }}
        >+</motion.button>
      </AnimatePresence>
    </div>
  );
}
