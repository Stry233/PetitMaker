/** One swatch strip tile: the plate, grown and recoloured while chosen, around the swatch's face. The
 *  road surfaces and the notes' colours wear it, one picker idiom above a tool row. */
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { ActionButton, type ActionButtonProps } from '../../primitives/ActionButton';
import { btnReset, cursors } from '../../design/styles';
import { ACTIVE, PLATE } from '../../design/tokens';
import { GROW, INNER, ROUND, TILE } from './swatch-strip';

/** The inner square a swatch's colour or picture fills. */
export const SWATCH_FACE: CSSProperties = { position: 'relative', width: INNER, height: INNER, borderRadius: INNER * ROUND };

export const SwatchTile = forwardRef<HTMLButtonElement, Omit<ActionButtonProps, 'interaction' | 'style' | 'children'> & {
  active?: boolean;
  children: ReactNode;
}>(function SwatchTile({ active, children, ...button }, ref) {
  return (
    <ActionButton
      ref={ref}
      interaction="tile"
      aria-pressed={active}
      {...button}
      style={{
        ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
        pointerEvents: 'auto', cursor: cursors.clickable,
        width: TILE, height: TILE,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span
        style={{
          position: 'absolute', background: active ? ACTIVE : PLATE,
          ...(active
            ? { inset: -GROW, borderRadius: (TILE + 2 * GROW) * ROUND }
            : { inset: 0, borderRadius: TILE * ROUND }),
        }}
      />
      {children}
    </ActionButton>
  );
});
