/**
 * The one text field: the window field box (`design/window-skin.ts:windowField`) drawn as a rounded
 * rectangle or a pill, a glyph leading the text and a slot standing inside its far end. The box wears
 * the focus ring (`FIELD_WRAP_CLASS` over `FIELD_INPUT_CLASS`), and Enter reaches `onEnter` only once
 * IME composition has finished. With `rows` the field is a textarea of that many lines. On a shelf's
 * band it is the cream plate edged as the plate buttons beside it.
 */
import type { CSSProperties, HTMLAttributes, InputHTMLAttributes, KeyboardEvent, ReactNode, Ref } from 'react';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../design/focus-source';
import { cursors, radii, UNAVAILABLE, type PwStyle } from '../design/styles';
import { DANGER_INK, MUTED_INK, PLATE, PLATE_INK, plateShapeEdge } from '../design/tokens';
import { skin, windowField, type WindowSurface } from '../design/window-skin';
import { isComposingKey } from '../../platform/input/text-entry';

type InputAttributes = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'style' | 'className' | 'children' | 'aria-label' | 'size'>;

export interface TextFieldProps extends InputAttributes {
  value: string;
  onChange: (value: string) => void;
  /** The field's accessible name. */
  label: string;
  shape?: 'rect' | 'pill';
  /** The surface the field stands on: a window's, which its fill stands one step off, or a shelf's
   *  dark band, where it is the cream plate with its shape edge. */
  on?: WindowSurface | 'band';
  /** Draws no box of its own, keeping its ink: it stands in a shape its caller draws. */
  bare?: boolean;
  /** A glyph before the text, hidden from assistive technology. */
  leading?: ReactNode;
  /** What stands inside the box after the text (a spinner, a control); it stays live while the text dims. */
  trailing?: ReactNode;
  /** Enter outside IME composition. */
  onEnter?: () => void;
  /** Hears an IME composition start and end. */
  onComposingChange?: (composing: boolean) => void;
  inputRef?: Ref<HTMLInputElement>;
  /** A textarea of this many lines rather than one line. */
  rows?: number;
  /** The edge turns to the danger ink, as a refused entry's does. */
  danger?: boolean;
  /** The box's height in css px, border-box; one line's own height where absent. */
  height?: number;
  /** The box's place, size and type in its parent (flex, width, height, padding, font); its paint
   *  stays the field's. */
  style?: CSSProperties;
  /** The text element's own alignment and fade. */
  textStyle?: CSSProperties;
  /** A test id for the box; `data-testid` names the text element. */
  boxTestId?: string;
  /** What the box wears beyond its paint: a help target, a piece of a re-arrangement. */
  boxAttrs?: HTMLAttributes<HTMLLabelElement>;
}

/** The inset at both ends of the box: the far end keeps it whether text or a trailing slot stands there. */
const SIDE = { rect: 10, pill: 16 } as const;

export function TextField({
  value, onChange, label, shape = 'rect', on = 'plate', bare = false, leading, trailing, onEnter, onComposingChange, inputRef, rows,
  danger = false, height, style, textStyle, boxTestId, boxAttrs, disabled, onKeyDown, ...attributes
}: TextFieldProps) {
  const band = on === 'band';
  const fill: CSSProperties = bare ? { background: 'transparent', border: 'none' }
    : band ? { background: PLATE, border: 'none', boxShadow: plateShapeEdge() }
    : { background: on === 'inset' ? skin.plate : skin.inset };
  const ink: PwStyle | null = band ? { color: PLATE_INK, '--pw-placeholder': MUTED_INK } : null;
  const box: CSSProperties = {
    ...windowField,
    display: 'flex', alignItems: rows ? 'flex-start' : 'center', gap: 8, cursor: cursors.text,
    ...fill, ...ink,
    borderRadius: shape === 'pill' ? radii.pill : radii.md,
    padding: `8px ${SIDE[shape]}px`,
    ...(danger ? { borderColor: DANGER_INK } : null),
    ...(height !== undefined ? { height } : null),
    ...style,
  };
  const text: CSSProperties = {
    font: 'inherit', color: 'inherit', background: 'none', border: 'none', outline: 'none', padding: 0, margin: 0,
    flex: 1, minWidth: 0, ...(rows ? { display: 'block', alignSelf: 'stretch', resize: 'none' } : null),
    ...(disabled ? { opacity: UNAVAILABLE } : null), ...textStyle,
  };
  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (!onEnter || e.defaultPrevented || e.key !== 'Enter' || isComposingKey(e.nativeEvent)) return;
    e.preventDefault();
    onEnter();
  };
  const shared = {
    ...attributes, value, disabled, 'aria-label': label, className: `pw-search-field ${FIELD_INPUT_CLASS}`,
    onKeyDown: keyDown, style: text,
  };
  return (
    <label {...boxAttrs} className={FIELD_WRAP_CLASS} data-testid={boxTestId} style={box}
      onCompositionStartCapture={onComposingChange && (() => onComposingChange(true))}
      onCompositionEndCapture={onComposingChange && (() => onComposingChange(false))}>
      {leading && <span aria-hidden style={{ display: 'flex', flex: 'none', color: skin.muted }}>{leading}</span>}
      {rows ? (
        <textarea {...(shared as InputHTMLAttributes<HTMLElement>)} rows={rows} ref={inputRef as Ref<HTMLTextAreaElement>}
          onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...shared} ref={inputRef} onChange={(e) => onChange(e.target.value)} />
      )}
      {trailing}
    </label>
  );
}
