import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { radii, cursors, pressable } from '../../../../design/styles';
import { skin } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { useT } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { PROC_PACK_META, STYLE_PACKS, type StylizeDirection } from '../../../../../io/stylize';
import { packSampleUrl } from './sample-assets';
import { useStylizeVersions } from './use-stylize-versions';
import { amplitude, framerMotion } from './motion';
import { MAP_ASPECT } from './sample-art';

const capStyle: CSSProperties = { ...roleFont('subhead'), color: skin.muted };

/** The i18n key naming a direction, custom included (STYLE_PACKS holds no entry for it). */
function directionNameKey(direction: StylizeDirection): string {
  return PROC_PACK_META.find((p) => p.id === direction)?.nameKey
    ?? STYLE_PACKS.find((p) => p.id === direction)?.nameKey
    ?? 'stylize.dir_custom';
}

/** Resting and hover poses for the three fanned map-ratio cards. */
const FAN_TRAVEL = amplitude('stylize.entry.fan');
const FAN_POSES = [
  { left: 0, top: 6, rest: -7, spreadRotate: -13, dx: -FAN_TRAVEL, dy: 1 },
  { left: 8, top: 3, rest: 2, spreadRotate: 2, dx: 0, dy: -2 },
  { left: 16, top: 7, rest: 9, spreadRotate: 15, dx: FAN_TRAVEL, dy: 1 },
] as const;

/** Three fanned cards previewing the style packs at the map's own ratio: the real sample once the
 *  tuning rig commits it, the pack's own palette otherwise — so the entry stands before any asset
 *  exists. Purely decorative; the label beside it carries the words. */
function FannedCards() {
  return (
    <span style={{ position: 'relative', width: 56, height: 40, flex: 'none' }} aria-hidden>
      {STYLE_PACKS.slice(0, 3).map((pack, i) => {
        const url = packSampleUrl(pack.id);
        const pose = FAN_POSES[i]!;
        return (
          <motion.span
            key={pack.id}
            variants={{
              rest: { rotate: pose.rest, x: 0, y: 0 },
              spread: { rotate: pose.spreadRotate, x: pose.dx, y: pose.dy },
            }}
            transition={framerMotion('stylize.entry.fan')}
            style={{
              position: 'absolute', left: pose.left, top: pose.top, width: 40, aspectRatio: MAP_ASPECT,
              borderRadius: 7, boxShadow: '0 1px 3px rgba(67,65,62,0.25)', zIndex: i, display: 'block',
              background: url ? `${skin.plate} url(${url}) center / cover no-repeat` : pack.palette[0],
            }}
          />
        );
      })}
    </span>
  );
}

/** The 画风 group in export controls: one entry button that opens the stylize window, its live
 *  sub-line naming whichever take the export currently carries. */
export function StylizeEntry() {
  const t = useT();
  const setModal = useEditorStore((s) => s.setModal);
  const { selected } = useStylizeVersions();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={capStyle}>{t('stylize.entry')}</div>
      <motion.button
        type="button"
        onClick={() => setModal('stylize', true)}
        initial="rest"
        animate="rest"
        whileHover="spread"
        // A full-width row uses a restrained hover scale instead of the compact-button growth.
        variants={{ rest: { scale: 1 }, spread: { scale: 1.02 } }}
        whileTap={pressable.whileTap}
        transition={framerMotion('stylize.entry.fan')}
        style={{ ...entryBtn, ...(selected ? appliedRing : null) }}
      >
        <FannedCards />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={labelStyle}>{t('stylize.entry_btn')}</span>
          <span style={subStyle}>
            {selected
              ? t('stylize.entry_version', { name: t(directionNameKey(selected.direction)), n: selected.no })
              : t('stylize.entry_default')}
          </span>
        </span>
        <span style={chevStyle}>▸</span>
      </motion.button>
    </div>
  );
}

const entryBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left',
  background: skin.inset, border: 'none', borderRadius: radii.lg,
  padding: '11px 12px', cursor: cursors.clickable, width: '100%', boxSizing: 'border-box',
};
/** Active-color ring for the style currently applied to the export. */
const appliedRing: CSSProperties = { boxShadow: `0 0 0 2px ${skin.active}` };
const labelStyle: CSSProperties = { ...roleFont('label'), color: skin.ink };
const subStyle: CSSProperties = {
  ...roleFont('caption'), color: skin.muted, maxWidth: '100%',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const chevStyle: CSSProperties = { ...roleFont('label'), color: skin.muted, flex: 'none' };
