/*
 * The parts a window inside `ModalShell` is laid out from: the card frame, a title row with Back and
 * Close at its ends, a body that takes the remaining height, and a footer with the way out on the
 * left and the confirming action on the right.
 */
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { interactionProfiles } from '../design/styles';
import { windowCard, windowIconButton, windowTitle } from '../design/window-skin';
import { BackIcon, CloseIcon } from './line-glyphs';

/** The card padding every window shares, in css px (top, sides, bottom). */
export const WINDOW_PADDING = '24px 24px 20px';
/** The glyph inside a window header's icon buttons, in css px. */
export const WINDOW_GLYPH = 18;
/** The gap between the footer's actions, in css px. */
export const WINDOW_FOOTER_GAP = 8;

/** The card frame: the window plate, the shared padding and a column the parts stack in. Spread into
 *  `ModalShell`'s `cardStyle`, then add what the window itself needs. */
export const windowFrame: CSSProperties = {
  ...windowCard,
  padding: WINDOW_PADDING,
  display: 'flex',
  flexDirection: 'column',
};

const titleRow: CSSProperties = { position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 40 };
const edgeButton: CSSProperties = { ...windowIconButton, position: 'absolute', top: 0, bottom: 0, marginBlock: 'auto' };

interface HeaderAction {
  /** The accessible name and tooltip, already translated. */
  label: string;
  onPress: () => void;
  'data-testid'?: string;
}

/**
 * The title row. Back stands at the start and Close at the end, both centred on the title's line;
 * `reserve` keeps the title clear of them when it wraps.
 */
export function WindowHeader({ title, titleId, back, close, reserve = false, style, children }: {
  title: ReactNode;
  titleId?: string;
  back?: HeaderAction;
  close?: HeaderAction;
  /** Pads the row by one icon button on both sides, so a long title never runs under Back or Close. */
  reserve?: boolean;
  style?: CSSProperties;
  /** Anything that stands after the title on its line, such as a tag. */
  children?: ReactNode;
}) {
  const pad = reserve ? { paddingInline: Number(windowIconButton.width) + 10 } : null;
  return (
    <div style={{ ...titleRow, ...pad, ...style }}>
      {back && (
        <motion.button type="button" {...interactionProfiles.tile} aria-label={back.label} title={back.label}
          data-testid={back['data-testid']} style={{ ...edgeButton, insetInlineStart: 0 }} onClick={back.onPress}>
          <BackIcon size={WINDOW_GLYPH} />
        </motion.button>
      )}
      <div id={titleId} style={windowTitle}>{title}{children}</div>
      {close && <WindowClose {...close} style={{ ...edgeButton, insetInlineEnd: 0 }} />}
    </div>
  );
}

/** The header's Close on its own, for a window whose head is a picture rather than a title row (About):
 *  the caller places it, at the same size and glyph as every other window's Close. */
export function WindowClose({ label, onPress, style, 'data-testid': testId }: HeaderAction & { style?: CSSProperties }) {
  return (
    <motion.button type="button" {...interactionProfiles.tile} aria-label={label} title={label}
      data-testid={testId} style={{ ...windowIconButton, ...style }} onClick={onPress}>
      <CloseIcon size={WINDOW_GLYPH} />
    </motion.button>
  );
}

/**
 * The footer row: `tertiary` at the start on its own, then the way out (`cancel`) and the confirming
 * action (`primary`) at the end, in that order in every window.
 */
export function WindowFooter({ cancel, primary, tertiary, style }: {
  cancel?: ReactNode;
  primary?: ReactNode;
  tertiary?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: WINDOW_FOOTER_GAP, ...style }}>
      {tertiary ? <div style={{ marginInlineEnd: 'auto', display: 'flex' }}>{tertiary}</div> : null}
      {cancel}
      {primary}
    </div>
  );
}
