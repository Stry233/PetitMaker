// Content-height changes animate inside ModalShell independently of its open/close motion.
import { IS_LITE } from '../../../core/runtime/edition';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT, localizedName } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { GridState } from '../../../core/model/types';
import { MAP_LIST, getMapTemplate } from '../../../config/maps';
import { hasCarriableContent } from '../../../kit/operations';
import { btnReset, buttonMotion, font, inkTint, pressable, cursors, radii } from '../../design/styles';
import { LoadingDots } from '../../primitives/LoadingDots';
import { ModalShell, SIZE_MORPH_TWEEN } from '../../primitives/ModalShell';
import { SegmentedControl } from '../../primitives/SegmentedControl';
import { useSizeGlide } from '../../hooks/use-size-glide';
import { skin, windowCard, windowLabel, windowPrimary, windowRow, windowTitle } from '../../design/window-skin';
import { roleFont } from '../../design/text-weight';
import { cssMotion } from '../../shell/motion/use-motion';
import { iconUrl } from '../../../assets/icon-urls';

export interface ChangePlanetModalProps {
  /** Drives the shared `ModalShell` open/close choreography. Defaults to `true`
   *  so tests can mount the modal directly; the shell passes `open={modals.newProject}`
   *  and keeps the component mounted so the card exit animates as one unit. */
  open?: boolean;
  /** The verb: open `templateId`, carrying this planet's build along or leaving it behind. */
  onSwitch: (templateId: string, carry: boolean) => void;
  onClose: () => void;
  /** The Help Center's preview map; when absent, carry availability reads the open map. */
  subject?: GridState;
  /** Open with this planet already picked, so a picture can show the chosen state: the carry row
   *  standing and the confirm button naming its destination. */
  initialChosen?: string;
}

// The unsaved-work row and the carry row both come and go with the state, so this card's content
// height varies more than most; capped the same way as the other windows so a landscape phone
// (390-412 css px tall, shorter than this card's worst case at FIT_FLOOR) scrolls the card rather
// than clipping its Switch/Cancel buttons.
const cardStyle: CSSProperties = {
  ...windowCard,
  padding: 28,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  overflowX: 'hidden',
};

/** Everything inside the card, and the box whose height eases. It carries the card's own column
 *  layout so there is one owner of it, and it CLIPS while it travels: for those few hundred ms it
 *  is shorter or taller than what stands in it, and a row must not re-lay itself out on the way. */
const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 22,
};

const titleStyle: CSSProperties = { ...windowTitle };

const gridStyle: CSSProperties = {
  display: 'flex',
  gap: 18,
  justifyContent: 'center',
  flexWrap: 'wrap',
};

const planetCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: 168,
  padding: '12px 0 14px',
  borderRadius: 22,
  border: 'none',
  background: 'transparent',
  ...roleFont('head'),
  color: skin.ink,
  fontFamily: font.family,
  WebkitTapHighlightColor: 'transparent',
  transition: cssMotion('planet.choice.select', 'background-color'),
};

/** The unsaved-work notice above the planet choices, and the way out of it. */
const warnStyle: CSSProperties = {
  // The sentence reads left-aligned against the button on the right; centred, a two-line wrap
  // straggles under a fixed-width button and looks like a mistake.
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
  margin: '0 20px', padding: '10px 16px',
  background: skin.active, borderRadius: radii.md,
  // The notice outranks the escape hatch beside it: `action` is the rung the Export button draws at.
  fontFamily: font.family, ...roleFont('action'), color: skin.ink,
};
const exportBtnStyle: CSSProperties = {
  ...windowPrimary, flex: '0 0 auto', padding: '6px 14px', whiteSpace: 'nowrap',
};

/** The carry row's second line: the contract and the stakes, receding under the label. */
const hintStyle: CSSProperties = {
  ...roleFont('caption'),
  lineHeight: 1.45,
  color: skin.muted,
  fontFamily: font.family,
};

const quietStyle: CSSProperties = {
  ...btnReset,
  alignSelf: 'center',
  padding: '4px 10px',
  fontFamily: font.family,
  ...roleFont('action'),
  color: skin.muted,
  cursor: cursors.clickable,
};

type Carry = 'carry' | 'fresh';

export function ChangePlanetModal({ open = true, onSwitch, onClose, subject, initialChosen }: ChangePlanetModalProps) {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  // Changing planet replaces this map, and the browser is the only copy of anything not exported.
  // The undo stack's length at the last export is the mark; anything past it lives only here.
  const exportedAt = useEditorStore((s) => s.exportedAt);
  const executor = useEditorStore((s) => s.commandExecutor);
  const liveState = useEditorStore((s) => s.gridState);
  const gridState = subject ?? liveState;
  const setModal = useEditorStore((s) => s.setModal);
  const edits = executor?.getUndoStackSize() ?? 0;
  const unsaved = edits > 0 && edits !== exportedAt;

  const [chosen, setChosen] = useState<string | null>(initialChosen ?? null);
  const [carry, setCarry] = useState<Carry>('carry');
  const [busy, setBusy] = useState(false);
  // The guard is a REF, not the busy state: the press yields a macrotask before it acts, and a
  // second press within that gap reads the state its own render closed over.
  const running = useRef(false);
  // The window stays mounted between opens, so each opening starts the question over.
  useEffect(() => {
    if (!open) return;
    setChosen(initialChosen ?? null);
    setCarry('carry');
    running.current = false;
    setBusy(false);
  }, [open, initialChosen]);

  /*
   * WHETHER THERE IS ANYTHING TO CARRY, asked of the operation that would carry it.
   *
   * This gates both the carry question and, through it, whether a transfer runs at all, so it must
   * not be a second opinion: a per-layer tally cannot see a ground-level edge cut (a `None` cell at
   * elevation 0), and a map whose only work is cuts would be read as empty and quietly reset. Walks
   * the grid, so it is computed only while the window is open and only when the map has moved.
   */
  const cellsVersion = gridState?.cellsVersion ?? 0;
  const objectsVersion = gridState?.objectsVersion ?? 0;
  const hasBuild = useMemo(
    () => !!gridState && open && hasCarriableContent(gridState),
    [gridState, open, cellsVersion, objectsVersion],
  );

  const currentId = gridState?.template.id;
  const destination = chosen ? getMapTemplate(chosen) : null;
  // CHOOSING YOUR OWN PLANET MEANS STARTING OVER, which is the one coherent thing it can mean:
  // there is nothing to carry to where you already are, so the carry row goes and the verb says
  // what the press does. It takes the same road a fresh switch does, on this template.
  const startingOver = !!chosen && chosen === currentId;

  const go = () => {
    if (!chosen || running.current) return;
    running.current = true;
    setBusy(true);
    const target = chosen;
    // Nothing to carry is nothing to transfer: a planet with no build takes the plain new-map road
    // rather than a replay that would spend its time moving an empty grid. The carry row is not on
    // screen in that state either, so the default it still holds is not an answer anyone gave.
    const bring = !startingOver && hasBuild && carry === 'carry';
    // One macrotask, the same yield a generate takes: the transfer's replay is synchronous, so the
    // busy state must reach the screen before the thread is taken. A CALLBACK rather than an awaited
    // promise, so a throw in there is an error the browser reports rather than a rejection nothing
    // is listening for.
    setTimeout(() => {
      try {
        onSwitch(target, bring);
      } finally {
        // A transfer that threw leaves the visitor on the planet they were already on, so the window
        // has to be usable again rather than stuck under its own dots.
        running.current = false;
        setBusy(false);
      }
    }, 0);
  };

  // Opening replaces the measured element and initializes the size used by its next transition.
  const body = useSizeGlide<HTMLDivElement>(
    `${open}|${chosen ?? ''}|${startingOver}|${hasBuild}|${unsaved}|${busy}|${locale}`,
    { axis: 'height', transition: SIZE_MORPH_TWEEN },
  );

  // NOT CLOSEABLE WHILE THE TRANSFER RUNS. Escape or a click outside would read as a cancel, and
  // there is nothing to cancel: the replay is already under way and will install its map either way.
  const close = () => { if (!running.current) onClose(); };

  return (
    <ModalShell helpTarget={{ page: 'planet' }} open={open} onClose={close} width={520} maxVh={90} cardStyle={cardStyle} ariaLabel={t('modal.new_title')}>
      <div
        ref={body.ref}
        data-testid="planet-body"
        style={body.gliding ? { ...bodyStyle, overflow: 'hidden' } : bodyStyle}
      >
        <div style={titleStyle}>{t('modal.new_title')}</div>
        {unsaved && (
          <div style={warnStyle}>
            <span>{t('modal.new_unsaved')}</span>
            <motion.button
              type="button"
              style={exportBtnStyle}
              onClick={() => { close(); setModal(IS_LITE ? 'share' : 'exportJson', true); }}
              {...pressable}
            >{t('modal.new_export_first')}</motion.button>
          </div>
        )}
        <div style={gridStyle}>
          {/* Each built-in map (from the maps registry) is shown as its little
              "planet" icon (basename convention `planet-<id>`) above its own
              localized name — no per-map roster or i18n key to maintain here. */}
          {MAP_LIST.map((tmpl) => {
            const here = tmpl.id === currentId;
            const art = (
              // drop-shadow (not a card box-shadow) so the shadow hugs the
              // planet's round silhouette, not the PNG's rectangle.
              <img
                src={iconUrl(`planet-${tmpl.id}`)}
                alt=""
                draggable={false}
                style={{ width: 108, height: 108, objectFit: 'contain', filter: `drop-shadow(0 6px 10px ${inkTint(0.28)})` }}
              />
            );
            const name = localizedName(tmpl.name, locale);
            const active = chosen === tmpl.id;
            return (
              <motion.button
                key={tmpl.id}
                type="button"
                aria-pressed={active}
                aria-current={here ? 'true' : undefined}
                data-testid={`planet-${tmpl.id}`}
                // The planet you are on RESTS on the inset fill, which is what makes the grid read
                // as "here, and where else"; chosen, it wears the same yellow as anywhere else,
                // because choosing it is a choice like any other.
                style={{ ...planetCardStyle, background: active ? skin.active : here ? skin.inset : 'transparent', cursor: cursors.clickable }}
                onClick={() => setChosen(tmpl.id)}
                {...pressable}
              >
                {art}
                <span>{name}</span>
              </motion.button>
            );
          })}
        </div>

        {hasBuild && !startingOver && (
          <div style={windowRow}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, marginRight: 'auto', maxWidth: 300 }}>
              <span style={{ ...windowLabel, marginRight: 0 }}>{t('planet.carry_label')}</span>
              <span style={hintStyle}>{t('planet.carry_hint')}</span>
            </span>
            <SegmentedControl
              idPrefix="planet-carry"
              value={carry}
              options={['carry', 'fresh'] as const}
              onChange={setCarry}
              render={(c) => t(c === 'carry' ? 'planet.carry_bring' : 'planet.carry_fresh')}
              stretch={false}
            />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {/* Starting over destroys the planet outright, and that is worth saying where the verb is
              rather than in the row that is not on screen for it. A planet with nothing on it has
              nothing to lose, so it is told nothing. */}
          {startingOver && hasBuild && (
            <span style={{ ...hintStyle, textAlign: 'center', maxWidth: 340 }} data-testid="planet-start-over-hint">
              {t('planet.start_over_hint')}
            </span>
          )}
          <motion.button
            type="button"
            data-testid="planet-switch"
            style={{ ...windowPrimary, minWidth: 200, opacity: destination && !busy ? 1 : 0.45, transition: cssMotion('planet.choice.select', 'opacity'), cursor: destination ? cursors.clickable : cursors.blocked }}
            disabled={!destination || busy}
            onClick={go}
            {...(destination && !busy ? buttonMotion : {})}
          >
            {busy ? (
              <span style={{ display: 'inline-flex', height: 15, alignItems: 'center' }}><LoadingDots color={skin.plate} /></span>
            ) : startingOver ? (
              t('planet.start_over')
            ) : destination ? (
              t('planet.switch_to', { name: localizedName(destination.name, locale) })
            ) : (
              // Before a destination is picked the verb has no object, so it says the plain thing
              // the arrival notice's own button says.
              t('arrival.switch')
            )}
          </motion.button>
          <button type="button" style={quietStyle} onClick={close}>{t('delete.cancel')}</button>
        </div>
      </div>
    </ModalShell>
  );
}
