/*
 * The connection page: the sample deck, and the provider, key, address and model a picture needs. The
 * model list is read off the key (`use-stylize-connection.ts`); every row stands from the first frame
 * and Start creating stays disabled rather than absent, so a refusal never moves a control.
 */
import { interactionProfiles, buttonMotion, cursors, font, radii, UNAVAILABLE, shadows } from '../../../../design/styles';
import { DANGER_INK, rgbaOf } from '../../../../design/tokens';
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimationControls, useMotionValue, useReducedMotionConfig, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { skin } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { useChromeScale } from '../../../../design/scale';
import { FloatMenu } from '../../../../primitives/FloatMenu';
import { Spinner } from '../../../../primitives/Spinner';
import { useT } from '../../../../../i18n/context';
import { illustrationProviderName } from '../../../../../i18n/providers';
import { STYLE_PACKS, STYLIZE_PROVIDERS, type StylizeProvider } from '../../../../../pipelines/stylize/facts';
import { packSampleUrl } from './sample-assets';
import { Field, GhostVerb, PrimaryVerb, SampleTile, StatusSlot, WindowFoot, entering, fieldBox, fieldLabel } from './stylize-parts';
import { amplitude, framerMotion, staggerDelay } from '../../../../design/motion';

import type { StylizeConnection } from './use-stylize-connection';
import { visualRect } from '../../../../design/visual-rect';
import { clientPoint } from '../../../../../platform/device/viewport-space';

/** The lean's declared spring (`stylize.deck.follow`, curve `stiff`), in the option shape
 *  `useSpring` takes: the same physics the transform's own transition would carry. */
function followSpring() {
  const m = framerMotion('stylize.deck.follow') as { stiffness?: number; damping?: number; mass?: number };
  return { stiffness: m.stiffness, damping: m.damping, mass: m.mass };
}

/** Where a deck card stands by its depth: 0 is the front card, nearly square to the box; 1 and 2
 *  lean away behind it. The vertical placement is the box's own `top` rather than a transform,
 *  since the breathing rides `y` and one transform channel cannot carry both. `follow` is each
 *  depth's share of the pointer travel: the front card leans farthest, the way near things do. */
const DECK_POSE = [
  { rotate: -1, x: '0%', top: '21%', follow: 1 },
  { rotate: 6, x: '20%', top: '31%', follow: 0.55 },
  { rotate: -9, x: '-20%', top: '28%', follow: 0.3 },
];

/** Where the pointer stands across `box`, from -1 at its left or top edge to 1 at the other. The
 *  box is a layout rect (`visualRect`), so the pointer is read in layout px through `clientPoint`. */
export function pointerLean(
  e: { clientX: number; clientY: number; nativeEvent?: unknown }, box: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const p = clientPoint(e);
  return { x: ((p.x - box.x) / box.width - 0.5) * 2, y: ((p.y - box.y) / box.height - 0.5) * 2 };
}

/** The whole deck is a control: every press tosses the front card and reveals the next of all the
 *  packs' samples, so the connection page already lets the styles be browsed. The pointer is
 *  followed while it crosses the box (`stylize.deck.follow`); both are decoration over cards that
 *  stand readable on their own, so reduced motion simply leaves the deck still. */
function Deck() {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const rise = amplitude('stylize.deck.breathe');
  const follow = amplitude('stylize.deck.follow');
  const [head, setHead] = useState(0);
  // The raw pointer position, then the sprung version the cards actually read: a bare `.set()`
  // lands in one frame, which reads as the deck snapping home the instant the pointer leaves;
  // through the lean's own spring the cards trail the pointer in and settle back out.
  const pxRaw = useMotionValue(0);
  const pyRaw = useMotionValue(0);
  const px = useSpring(pxRaw, followSpring());
  const py = useSpring(pyRaw, followSpring());
  const boxRef = useRef<HTMLButtonElement>(null);

  const onMove = (e: ReactMouseEvent) => {
    if (reduced) return;
    const r = boxRef.current ? visualRect(boxRef.current) : null;
    if (!r) return;
    const lean = pointerLean(e, r);
    pxRaw.set(lean.x * follow);
    pyRaw.set(lean.y * follow);
  };
  const onLeave = () => { pxRaw.set(0); pyRaw.set(0); };

  const count = STYLE_PACKS.length;
  return (
    <motion.button
      type="button"
      ref={boxRef}
      onClick={() => setHead((h) => h + 1)}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      aria-label={t('stylize.deck_next')}
      title={t('stylize.deck_next')}
      whileTap={interactionProfiles.toggleTap.whileTap}
      transition={buttonMotion.transition}
      style={{
        position: 'relative', borderRadius: radii.card, background: skin.inset, overflow: 'hidden',
        border: 'none', padding: 0, cursor: cursors.clickable, display: 'block', width: '100%', height: '100%',
      }}
   >
      <AnimatePresence initial={false}>
        {STYLE_PACKS.map((pack, idx) => {
          const depth = (idx - (head % count) + count) % count;
          if (depth >= DECK_POSE.length) return null;
          // Keyed by pack and revolution: `head` never wraps, so a card spinning back into the
          // stack while its previous self is still mid-exit arrives under a fresh key instead of
          // colliding with it (a duplicate key makes AnimatePresence drop the newcomer, which
          // showed as the back card missing after a burst of fast presses).
          return (
            <DeckCard
              key={`${pack.id}:${Math.floor((head + 2 - idx) / count)}`}
              pack={pack}
              depth={depth}
              px={px}
              py={py}
              reduced={reduced}
              rise={rise}
            />
          );
        })}
      </AnimatePresence>
    </motion.button>
  );
}

/**
 * One card of the deck, in two layers so its three motions keep their channels: the outer layer is
 * the card's place in the box and carries the pointer lean (`x`/`y` motion values), so the whole
 * card — frame, shadow and picture together — leans as one thing; the inner layer is the card
 * itself and carries the pose (rotate + fan offset), the breathing, and the shuffle's enter/leave.
 */
function DeckCard({ pack, depth, px, py, reduced, rise }: {
  pack: (typeof STYLE_PACKS)[number]; depth: number;
  px: MotionValue<number>; py: MotionValue<number>;
  reduced: boolean; rise: number;
}) {
  const pose = DECK_POSE[depth]!;
  const shareRef = useRef(pose.follow);
  shareRef.current = pose.follow;
  const fx = useTransform(px, (v) => v * shareRef.current);
  const fy = useTransform(py, (v) => v * shareRef.current);
  const shuffle = framerMotion('stylize.deck.shuffle');
  return (
    <motion.div
      animate={{ top: pose.top }}
      transition={shuffle}
      style={{ position: 'absolute', width: '56%', left: '22%', top: pose.top, zIndex: DECK_POSE.length - depth, x: fx, y: fy }}
   >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{
          opacity: 1, scale: 1, rotate: pose.rotate, x: pose.x,
          y: reduced ? 0 : [0, -rise, 0],
        }}
        // The front card leaves by dropping out of the stack the way a dealt card does.
        exit={{ opacity: 0, y: 30, rotate: pose.rotate - 8, transition: shuffle }}
        transition={{
          ...shuffle,
          y: { ...framerMotion('stylize.deck.breathe'), repeat: Infinity, delay: staggerDelay('stylize.deck.breathe', depth) },
        }}
        style={{
          borderRadius: radii.field, overflow: 'hidden', background: skin.plate,
          boxShadow: shadows.s2,
        }}
     >
        <SampleTile url={packSampleUrl(pack.id)} art={pack} radius={14} />
      </motion.div>
    </motion.div>
  );
}

/** A row that is standing but has nothing to open: the model row before a key, and while the list
 *  is being read. Drawn as the menu row it will become, so the row does not move when it does. */
function StaticRow({ children, dim }: { children: ReactNode; dim: boolean }) {
  const style: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, minHeight: 42,
    background: skin.inset, color: skin.plateInk, borderRadius: radii.md,
    padding: '10px 12px', fontFamily: font.family, ...roleFont('menu'),
    opacity: dim ? UNAVAILABLE : 1,
  };
  return <div style={style}>{children}</div>;
}

/** One row of the form, arriving in the order the form asks for it. */
function Row({ index, children }: { index: number; children: ReactNode }) {
  return (
    <motion.div {...entering(index)} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      {children}
    </motion.div>
  );
}

export function Hero({ conn, onStart, onDismiss }: {
  conn: StylizeConnection;
  onStart: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const zoom = useChromeScale();
  const [menu, setMenu] = useState<'provider' | 'model' | null>(null);
  const shake = useAnimationControls();
  const reduced = useReducedMotionConfig() === true;
  const custom = conn.provider === 'custom';

  // The refusal names a field, and the shake is what says which: driven from the nonce rather than
  // declared on the element, since the same field stands whether or not it was the one refused.
  useEffect(() => {
    if (conn.shakeNonce === 0 || reduced) return;
    const px = amplitude('stylize.fail.shake');
    void shake.start({ x: [0, -px, px, -px, 0] }, framerMotion('stylize.fail.shake'));
  }, [conn.shakeNonce, reduced, shake]);

  const providerName = (id: StylizeProvider['id']) => illustrationProviderName(id, t);

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, paddingTop: 8 }}>
        <Deck />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center', minHeight: 0, padding: 2 }}>
          <Row index={0}>
            <span style={fieldLabel}>{t('stylize.provider')}</span>
            <FloatMenu
              aria-label={t('stylize.provider')}
              row={providerName(conn.provider)}
              items={STYLIZE_PROVIDERS.map((p) => ({ id: p.id, label: providerName(p.id) }))}
              activeId={conn.provider}
              open={menu === 'provider'}
              onOpen={() => setMenu('provider')}
              onClose={() => setMenu(null)}
              onPick={(id) => { conn.setProvider(id as StylizeProvider['id']); setMenu(null); }}
              zoom={zoom}
            />
          </Row>

          <Row index={1}>
            <motion.div animate={shake}>
              <Field label={t('stylize.key')}>
                <input
                  type="password"
                  value={conn.key}
                  placeholder={t('stylize.key_ph')}
                  onChange={(e) => conn.setKey(e.target.value)}
                  style={{ ...fieldBox, borderColor: conn.status ? DANGER_INK : skin.line }}
                />
              </Field>
            </motion.div>
          </Row>

          {/* The address row is the custom endpoint's alone. It stays in the tree at zero height so
              the rows below it never re-mount, and unfolds where the provider needs it. */}
          <motion.div
            initial={false}
            animate={{ height: custom ? 'auto' : 0, opacity: custom ? 1 : 0 }}
            transition={framerMotion('stylize.address.unfold')}
            style={{ overflow: 'hidden' }}
         >
            <Field label={t('stylize.base_url')}>
              <input
                type="text"
                value={conn.baseUrl}
                onChange={(e) => conn.setBaseUrl(e.target.value)}
                style={fieldBox}
              />
            </Field>
          </motion.div>

          <Row index={3}>
            {conn.modelsState === 'ready' ? (
              <motion.div
                key={conn.arrivedNonce}
                initial={{ boxShadow: `0 0 0 3px ${skin.active}` }}
                animate={{ boxShadow: `0 0 0 3px ${rgbaOf(skin.active, 0)}` }}
                transition={framerMotion('stylize.model.arrive')}
                style={{ borderRadius: radii.md, display: 'flex', flexDirection: 'column', gap: 4 }}
             >
                <span style={fieldLabel}>{t('stylize.model')}</span>
                <FloatMenu
                  aria-label={t('stylize.model')}
                  row={conn.model}
                  items={conn.models.map((id) => ({ id, label: id }))}
                  activeId={conn.model}
                  open={menu === 'model'}
                  onOpen={() => setMenu('model')}
                  onClose={() => setMenu(null)}
                  onPick={(id) => { conn.setModel(id); setMenu(null); }}
                  zoom={zoom}
                />
              </motion.div>
            ) : conn.modelsState === 'unlisted' ? (
              <Field label={t('stylize.model')}>
                <input
                  type="text"
                  value={conn.model}
                  placeholder={t('stylize.model_typed_ph')}
                  onChange={(e) => conn.setModel(e.target.value)}
                  style={fieldBox}
                />
              </Field>
            ) : (
              <>
                <span style={fieldLabel}>{t('stylize.model')}</span>
                <StaticRow dim>
                  {conn.modelsState === 'loading' ? (
                    <>
                      <Spinner size={15} />
                      <span>{t('stylize.model_loading')}</span>
                    </>
                  ) : null}
                </StaticRow>
              </>
            )}
          </Row>

          <Row index={4}>
            <span style={{ ...roleFont('caption'), color: skin.muted, lineHeight: 1.4 }}>{t('stylize.disclosure')}</span>
          </Row>
        </div>
      </div>

      <WindowFoot>
        <StatusSlot status={conn.status} busy={conn.verifying} />
        <GhostVerb onClick={onDismiss}>{t('export.btn_cancel')}</GhostVerb>
        <PrimaryVerb disabled={!conn.ready} onClick={onStart}>{t('stylize.start')}</PrimaryVerb>
      </WindowFoot>
    </>
  );
}
