/**
 * The keyboard board: the main block, the navigation cluster and the numeric keypad, each key tinted
 * by its command's category at the engaged modifier layer. It assembles itself just after the card
 * lands (clusters staggered, the main block row by row) and never moves under reduced motion.
 */
import type { CSSProperties } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { framerMotion } from '../../../design/motion';
import { font, interactionProfiles, radii, cursors } from '../../../design/styles';
import { inkTint } from '../../../design/tokens';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useWeightVars } from '../../../design/scale';
import { COMMAND_BY_ID } from '../../../../editor/commands/commands';
import { BOARD_IN, CLUSTER_IN, ROW_IN, ROW_IN_REDUCED } from './motion';
import { KEY_ROWS, NUMPAD, NUMPAD_COLS, NUMPAD_ROWS_N, NAV, NAV_COLS, NAV_ROWS_N, CATEGORY_COLOR, comboFor, type KeyDef, type Layer } from './layout';

// Keycap metrics, sized so the labels stay legible after the chrome zoom shrinks the card.
const UNIT = 60;
const GAP = 6;
const KEY_H = 58;
const BOARD_GAP = 24;

/** The board's width and height in CSS px at zoom 1: a flex row renders to units*`UNIT` + (units-1)*`GAP`
 *  whatever the key count, and the widest main row sets the board. */
const clusterW = (units: number): number => units * UNIT + (units - 1) * GAP;
const BOARD_UNITS = Math.max(...KEY_ROWS.map((r) => r.reduce((s, k) => s + (k.w ?? 1), 0)));
export const KEYBOARD_W = clusterW(BOARD_UNITS) + BOARD_GAP * 2 + clusterW(NAV_COLS) + clusterW(NUMPAD_COLS);
export const KEYBOARD_H = KEY_ROWS.length * KEY_H + (KEY_ROWS.length - 1) * GAP;

export function KeyboardBoard({ layer, index, aliases, selectedId, label, zoom, onPick, onToggleMod }: {
  layer: Layer;
  /** The commands bound per combo, and the alias keys that also reach one. */
  index: Map<string, string>;
  aliases: Map<string, string>;
  selectedId: string | null;
  label: (id: string) => string;
  zoom: number;
  onPick: (id: string) => void;
  onToggleMod: (mod: 'ctrl' | 'alt' | 'shift') => void;
}) {
  const reduced = useReducedMotionConfig();
  // The board's fitting zoom shrinks its keycap text below the card's, so it resolves its own weights.
  const weights = useWeightVars(zoom);
  const rowIn = reduced ? ROW_IN_REDUCED : ROW_IN;
  const pick = onPick;
  const toggleMod = onToggleMod;
  const renderKey = (key: KeyDef, ri: number, ki: number) => {
    const w = key.w ?? 1;
    const width = w * UNIT + (w - 1) * GAP;
    if (key.spacer) return <div key={`${ri}-${ki}`} style={{ width, height: KEY_H, flex: '0 0 auto' }} />;
    const grid = key.col != null;
    const combo = comboFor(key, layer);
    const cmdId = combo ? (index.get(combo) ?? aliases.get(combo)) : undefined;
    const cmd = cmdId ? COMMAND_BY_ID.get(cmdId) : undefined;
    // An alias key (arrow→pan, backspace→delete, ctrl+y→redo) shows its command but isn't the
    // command's editable primary binding — mark it with a dashed border.
    const isAlias = !!combo && !!cmd && !index.has(combo);
    const isSelected = !!cmd && cmd.id === selectedId;
    // A key that represents a modifier layer lights up while that layer is engaged, whether or not it
    // also carries a command: `mod` (Ctrl/Alt, which toggle on click) and `layerOf` (Shift, which
    // holds the constrain binding and stays selectable) both count, in every combination.
    const layerKeyOf = key.mod ?? key.layerOf;
    const modActive = layerKeyOf ? layer[layerKeyOf] : false;
    const interactive = !!key.mod || (!key.fixed);

    const st: CSSProperties = {
      position: 'relative',
      width: grid ? '100%' : width, height: grid ? '100%' : KEY_H, flex: grid ? undefined : '0 0 auto',
      gridColumn: grid ? `${key.col} / span ${key.colSpan ?? 1}` : undefined,
      gridRow: grid ? `${key.row} / span ${key.rowSpan ?? 1}` : undefined,
      borderRadius: radii.md, boxSizing: 'border-box', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '2px 4px', textAlign: 'center', userSelect: 'none', fontFamily: font.family,
      cursor: interactive ? cursors.clickable : cursors.default,
      border: isAlias ? `1.5px dashed ${inkTint(0.35)}` : `1.5px solid ${inkTint(0.18)}`,
      // Ink, not the active yellow the rest of the window marks a choice in: two of the ten
      // category tints are that yellow, so a ring in it disappears on exactly the keys a visitor
      // reaches for most (every tool and every brush).
      boxShadow: isSelected ? `0 0 0 3px ${skin.ink}` : undefined,
      zIndex: isSelected ? 2 : undefined,
    };

    // The fill is animated rather than set in `style`, so switching modifier layer eases the tint in
    // place instead of snapping. An engaged modifier layer wins it, so Shift reads the same as
    // Ctrl/Alt; otherwise a fixed key is muted and a bound key takes its category tint.
    const bg = modActive
      ? skin.active
      : key.fixed ? inkTint(0.07)
        : cmd ? CATEGORY_COLOR[cmd.category] : skin.plate;

    const onClick = (): void => {
      if (key.mod) { toggleMod(key.mod); return; }
      if (key.fixed) return;
      if (cmd) pick(cmd.id);
    };

    return (
      <motion.div
        key={`${ri}-${ki}`}
        style={st}
        onClick={onClick}
        title={cmd ? label(cmd.id) : undefined}
        animate={{ backgroundColor: bg }}
        whileHover={interactive ? interactionProfiles.keyboardKey.whileHover : undefined}
        whileTap={interactive ? interactionProfiles.keyboardKey.whileTap : undefined}
        transition={{ default: framerMotion('control.settle'), backgroundColor: framerMotion('control.tint') }}
     >
        {/* The engraved glyph never changes with the layer, so it stays put and is not animated. */}
        <span style={{ position: 'absolute', top: 4, left: 6, ...roleFont('small'), color: inkTint(key.fixed ? 0.55 : 0.5) }}>
          {key.label}
        </span>
        {/* Only the command label differs per layer, so it cross-fades inside a fixed box: the
            outgoing and incoming labels are both absolute, hence they overlap and dissolve into each
            other in place. */}
        <div style={{ position: 'absolute', left: 3, right: 3, top: 19, bottom: 2 }}>
          <AnimatePresence initial={false}>
            {cmd && (
              <motion.span
                key={cmd.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={framerMotion('control.hint')}
                style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
             >
                {/* clamped inside the centred fader, so a long label still ellipsizes at two lines */}
                <span style={{
                  ...roleFont('caption'), lineHeight: 1.12, color: skin.ink, textAlign: 'center',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', wordBreak: 'break-word',
                }}>
                  {label(cmd.id)}
                </span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  };

  const board = (rows: KeyDef[][]) => (
    <motion.div variants={CLUSTER_IN} style={{ display: 'flex', flexDirection: 'column', gap: GAP, alignItems: 'flex-start' }}>
      {rows.map((row, ri) => (
        <motion.div key={ri} variants={rowIn} style={{ display: 'flex', gap: GAP }}>
          {row.map((k, ki) => renderKey(k, ri, ki))}
        </motion.div>
      ))}
    </motion.div>
  );

  // The nav + numpad clusters settle as one unit each — staggering their individual keys as well
  // would turn a short cascade into a shimmer.
  const gridBoard = (keys: KeyDef[], cols: number, rows: number, tag: number, topOffset = 0) => (
    <motion.div variants={rowIn} style={{
      display: 'grid', gap: GAP, marginTop: topOffset,
      gridTemplateColumns: `repeat(${cols}, ${UNIT}px)`,
      gridTemplateRows: `repeat(${rows}, ${KEY_H}px)`,
    }}>
      {keys.map((k, i) => renderKey(k, tag, i))}
    </motion.div>
  );

  return (
    <motion.div
      variants={BOARD_IN}
      initial="hidden"
      animate="show"
      style={{ display: 'flex', gap: BOARD_GAP, alignItems: 'flex-start', width: 'max-content', flex: '0 0 auto', padding: '6px 6px 0', zoom, ...weights }}
       >
      {board(KEY_ROWS)}
      {gridBoard(NAV, NAV_COLS, NAV_ROWS_N, 98)}
      {/* numpad's NumLk row starts at the number-row level (one row down) so its bottom aligns */}
      {gridBoard(NUMPAD, NUMPAD_COLS, NUMPAD_ROWS_N, 99, KEY_H + GAP)}
    </motion.div>
  );
}
