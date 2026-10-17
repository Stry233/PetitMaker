/** The press plate behind a layer-panel row, filled while its row is the panel's selected one. */
import { ActionButton, type ActionButtonProps } from '../../primitives/ActionButton';
import { useTransition } from '../../design/motion/use-motion';
import { btnReset, cursors } from '../../design/styles';
import { ACTIVE, INSET, rgbaOf } from '../../design/tokens';

/** The unselected plate: the selected fill at no alpha, so the fade between them never passes through black. */
const AT_REST = rgbaOf(ACTIVE, 0);

/** The floors' and the notes row's one selected treatment: the fill fades on `layer.select.fade` and a hover tints only an unselected plate. */
export function LayerRowPlate({ selected, style, ...props }: { selected: boolean } & Omit<ActionButtonProps, 'interaction' | 'fill' | 'fillTransition' | 'hoverFill' | 'aria-pressed'>) {
  const fade = useTransition('layer.select.fade');
  return (
    <ActionButton
      {...props}
      interaction="row"
      aria-pressed={selected}
      fill={selected ? ACTIVE : AT_REST}
      fillTransition={fade}
      hoverFill={selected ? undefined : INSET}
      style={{ ...btnReset, position: 'absolute', inset: 0, cursor: cursors.clickable, ...style }}
    />
  );
}
