/*
 * KeymapMiniature.tsx — the live keymap as a picture: the main typing block with every keycap
 * wearing its command's category color at the base layer, no key text. It reads the same binding
 * index the shortcuts board does, so a rebind or a preset switch repaints it. Drawn as one SVG so
 * the geometry never depends on flex rounding and the whole thing scales to its container's width.
 */
import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { aliasIndex, bindingIndex, useKeybinds } from '../../../../core/runtime/keybindings';
import { COMMAND_BY_ID } from '../../../../kit/commands';
import { inkTint } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { CATEGORY_COLOR, KEY_ROWS, comboFor, type Layer } from './layout';

const BASE: Layer = { ctrl: false, alt: false, shift: false };

// Key geometry in viewBox units. A key of width w spans w*U + (w-1)*G, the same rule the full
// board uses, which is what makes every row total the same width and the right edge align.
const U = 20;
const G = 3;
const KEY_H = 18;
const ROW_G = 3;
const STROKE = 1.2;
// An SVG stroke is centred on the shape's edge, so the outer half of every border key's stroke
// falls outside a viewBox drawn to the key grid alone. The drawing carries its own margin instead.
const PAD = STROKE / 2;

// The typing block: KEY_ROWS minus the function row. The F-row is almost entirely unbound, so at
// stamp scale it adds a strip of blank caps and no information.
const ROWS = KEY_ROWS.slice(1);

const VIEW_W = 15 * U + 14 * G + PAD * 2;
const VIEW_H = ROWS.length * KEY_H + (ROWS.length - 1) * ROW_G + PAD * 2;

export function KeymapMiniature({ style }: { style?: CSSProperties }) {
  const overrides = useKeybinds((s) => s.overrides);
  const index = useMemo(() => bindingIndex(overrides), [overrides]);
  const aliases = useMemo(() => aliasIndex(), []);

  const keys: ReactNode[] = [];
  ROWS.forEach((row, ri) => {
    let x = PAD;
    const y = PAD + ri * (KEY_H + ROW_G);
    row.forEach((key, ki) => {
      const w = key.w ?? 1;
      const width = w * U + (w - 1) * G;
      if (!key.spacer) {
        const combo = comboFor(key, BASE);
        const cmdId = combo ? (index.get(combo) ?? aliases.get(combo)) : undefined;
        const cmd = cmdId ? COMMAND_BY_ID.get(cmdId) : undefined;
        const fill = key.fixed ? inkTint(0.07) : cmd ? CATEGORY_COLOR[cmd.category] : skin.plate;
        keys.push(
          <rect
            key={`${ri}-${ki}`}
            x={x}
            y={y}
            width={width}
            height={KEY_H}
            rx={4}
            fill={fill}
            stroke={inkTint(0.18)}
            strokeWidth={STROKE}
          />,
        );
      }
      x += width + G;
    });
  });

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      style={{ display: 'block', width: '100%', height: 'auto', ...style }}
      aria-hidden
    >
      {keys}
    </svg>
  );
}
