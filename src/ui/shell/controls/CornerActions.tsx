/** The top-right cluster: save-and-share, the load disc and the menu, standing on the mode row's line. */
import { useCallback, useRef, type CSSProperties, type MutableRefObject, type Ref } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { helpTargetAttr } from '../../session/help-targets';
import type { HelpPageId } from '../../help/page-schema';
import { tourTargetAttr, type TourTargetId } from '../../chrome/tour/steps';
import { cssMotion } from '../../design/motion';
import { ShapeEdge } from '../../design/shape-edge';
import { btnReset, cursors, z } from '../../design/styles';
import { FOCUS_SHAPE_RADIUS, mapShape } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { TouchReach } from '../../primitives/TouchReach';
import { useFrameZoom } from '../use-frame-zoom';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { TOP_RIGHT_TOP, cornerArt, topRightHeight, topRightSlack, type FrameArt } from '../frame';
import { useFrameLayout, usePlanGlide } from '../frame-layout';
import { EDGE_RIGHT, TOP_RIGHT_GAP } from '../units';
import { LoadMeter } from './LoadMeter';
import type { ChromeSwap } from './ModeRow';
import { useMorph } from '../../primitives/morph';

/**
 * One drawn control, at its own height so its ink reads at a rail button's size, its slack hanging
 * below the line. The drawing is a silhouette in the column's cream with the map's hairline.
 */
function Piece({ art, onPress, expanded, tourTarget, helpTarget, buttonRef }: {
  art: FrameArt & { src: string };
  buttonRef?: Ref<HTMLButtonElement>;
  onPress?: () => void;
  expanded?: boolean;
  tourTarget?: TourTargetId;
  helpTarget?: HelpPageId;
}) {
  const t = useT();
  const zoom = useFrameZoom();
  const h = topRightHeight(art);
  const w = (art.w / art.h) * h;
  const box: CSSProperties = { height: h, width: w, flex: 'none' };
  const line: CSSProperties = { ...box, marginBottom: -topRightSlack(art) };
  const shape = (
    <ShapeEdge style={box}>
      <span style={{ ...mapShape(art.src), display: 'block', width: '100%', height: '100%' }} />
    </ShapeEdge>
  );
  if (!onPress) return <span role="img" aria-label={t(art.labelKey)} style={line}>{shape}</span>;
  return (
    <ActionButton
      ref={buttonRef}
      interaction="tile"
      {...(tourTarget ? tourTargetAttr(tourTarget) : {})}
      {...(helpTarget ? helpTargetAttr(helpTarget) : {})}
      aria-label={t(art.labelKey)}
      aria-expanded={expanded}
      onClick={onPress}
      style={{ ...btnReset, ...line, position: 'relative', cursor: cursors.clickable, borderRadius: art.focusRadius ?? FOCUS_SHAPE_RADIUS }}
    >
      {shape}
      <TouchReach zoom={zoom} />
    </ActionButton>
  );
}

/** A planet session keeps only the menu. A member with no drawing of its own is the load disc, drawn here. */
export function CornerActions({ inSession, swap, menuOpen, toggleMenu, menuButton }: {
  inSession: boolean;
  swap: ChromeSwap;
  menuOpen: boolean;
  toggleMenu: () => void;
  menuButton: MutableRefObject<HTMLButtonElement | null>;
}) {
  const layout = useFrameLayout();
  const setModal = useEditorStore((s) => s.setModal);
  // A session change keys a new corner in before the old one leaves, so the leaving copy clears the
  // shared ref only while it still holds its own button.
  const own = useRef<HTMLButtonElement | null>(null);
  const holdMenuButton = useCallback((node: HTMLButtonElement | null) => {
    if (node) { own.current = node; menuButton.current = node; } else if (menuButton.current === own.current) menuButton.current = null;
  }, [menuButton]);
  const morph = useMorph('corner');
  const glide = usePlanGlide('frame.layout.adapt');
  // An unfolded mode row passes over the corner, which steps away until the row folds again.
  const aside = !!layout?.modeRow.open;
  return (
    <motion.div
      {...swap}
      {...morph}
      data-testid={inSession ? 'planet-session-corner' : 'shell-corner-actions'}
      {...mapEdgeAttr('top')}
      style={{
        position: 'fixed', top: layout?.cornerTop ?? TOP_RIGHT_TOP, right: layout?.edgeRight ?? EDGE_RIGHT, zIndex: z.panel,
        transition: glide(['top']),
        display: 'flex', alignItems: 'flex-end', gap: TOP_RIGHT_GAP, pointerEvents: aside ? 'none' : 'auto',
      }}
    >
      <div {...(aside ? { inert: '' } : {})} style={{
        display: 'flex', alignItems: 'flex-end', gap: TOP_RIGHT_GAP,
        opacity: aside ? 0 : 1, transition: cssMotion('shell.row.fade', ['opacity']),
      }}>
      {cornerArt(inSession).map(({ opens, ...art }) => (art.src === undefined ? (
        <LoadMeter key={art.id} art={art} />
      ) : (
        <Piece
          key={art.id}
          art={{ ...art, src: art.src }}
          onPress={opens === 'menu' ? toggleMenu : opens ? () => setModal(opens, true) : undefined}
          expanded={opens === 'menu' ? menuOpen : undefined}
          {...(opens === 'menu' ? { buttonRef: holdMenuButton } : {})}
          tourTarget={art.tourTarget}
          helpTarget={art.helpTarget}
        />
      )))}
      </div>
    </motion.div>
  );
}
