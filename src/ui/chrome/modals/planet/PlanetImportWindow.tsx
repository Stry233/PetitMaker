/**
 * Import planet's window over Change Planet: From a planet file hands the press to Change Planet's
 * picker; From a game video shows the guide, reads the video on this device with progress and Cancel,
 * and opens the planet read in the planet editor. Dropped and picked files go where their kind belongs.
 * The read is the page's (`editor/session/planet-scan.ts:planetScan`): the window draws it, and a
 * planet read stays there when the window closes, so the next opening offers it again.
 */
import { useWindow, type WindowProps } from '../use-window';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { SUPPORTS_JSON_FILES } from '../../../../platform/build/edition';
import { useLocale, useT } from '../../../../i18n/context';
import { planetScan, type PlanetScan } from '../../../../editor/session/planet-scan';
import type { HandedImport } from '../../../../state/slices/shell';
import { useImportFlow, type ImportRouting } from '../import/use-import-flow';
import { useHandedImport } from '../import/use-handed-import';
import { showToast } from '../../../../platform/channels/toast-bus';
import { ConfirmationModal } from '../../../primitives/ConfirmationModal';
import { useRedirectContent } from '../import/ImportRedirect';
import { cssMotion, seconds } from '../../../design/motion';
import { radii } from '../../../design/styles';
import { OVERLAY_DIM_WORKING } from '../../../design/tokens';
import { roleFont } from '../../../design/text-weight';
import { skin, windowChip } from '../../../design/window-skin';
import { useSizeGlide } from '../../../primitives/use-size-glide';
import { ActionButton } from '../../../primitives/ActionButton';
import { ImportFileIcon, VideoIcon } from '../../../primitives/line-glyphs';
import { ModalShell, PANEL_CAP_W, cappedRoom } from '../../../primitives/ModalShell';
import { WINDOW_PADDING_X, WindowBody, WindowFooter, WindowHeader, windowColumn, windowFrame } from '../../../primitives/Window';
import { carriesFiles } from '../../../primitives/use-file-pick';
import { FIT_FLOOR, MIN_UI_ROOM } from '../../../design/scale';
import { PlanetStep } from './PlanetStep';
import { VideoImportGuide } from './VideoImportGuide';
import { VideoImportProgress } from './VideoImportProgress';
import { useRoomColumns } from '../use-window-columns';

/** Where the visitor stands before a read: the two ways to import, or the video's guide. */
type Entry = 'choose' | 'guide';

const ROUTING: ImportRouting = { map: 'card', planet: 'hand', video: 'read', unknown: 'refuse' };

/** The room, in card px, below which the guide stands its protocol above the example: what the least
 *  workspace at the chrome fit's floor gives this window's card less its padding, the frame ModalShell
 *  measures for a card with no border. The least workspace and every wider window keep two columns; a
 *  narrower one stacks. */
const STACK_BELOW_ROOM = cappedRoom(PANEL_CAP_W, MIN_UI_ROOM.w, FIT_FLOOR, 2 * WINDOW_PADDING_X);

const cardStyle: CSSProperties = windowFrame;
const choiceStyle: CSSProperties = {
  position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 132, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
  padding: '20px 16px', border: 'none', borderRadius: radii.lg, background: skin.inset, color: skin.ink, ...roleFont('head'),
  WebkitTapHighlightColor: 'transparent', textAlign: 'center',
};
const choiceArt: CSSProperties = { width: 52, height: 52, borderRadius: '50%', background: skin.plate, display: 'grid', placeItems: 'center' };
/** The Beta tag in a choice's top end corner and after the guide's title. */
const choiceTag: CSSProperties = { ...windowChip('inset'), position: 'absolute', top: 10, insetInlineEnd: 10, padding: '2px 10px' };
const titleTag: CSSProperties = { ...windowChip('plate'), padding: '2px 10px', marginInlineStart: 10, verticalAlign: 'middle', whiteSpace: 'nowrap' };

interface PlanetImportWindowProps extends WindowProps {
  /** From a planet file: Change Planet's file picker, opened inside this press. */
  onPickFile?: () => void;
  /** Whether a planet editor may open now; the video import waits for it otherwise. */
  canEdit: boolean;
  /** The read this window draws: the page's, or a scripted one a test passes. */
  session?: PlanetScan;
  /** Whether a video another import surface handed over is read here as the window opens. */
  takesHandedFiles?: boolean;
}

/** Stops the read `session` has under way; a planet it holds stays. */
const stopReading = (session: PlanetScan): void => { if (session.snapshot().reading) session.cancel(); };

function Choice(
  { testId, icon, label, tag, disabled, onClick }: { testId: string; icon: ReactNode; label: string; tag?: string; disabled?: boolean; onClick: () => void },
) {
  return (
    <ActionButton interaction="row" data-testid={testId} disabled={disabled} onClick={onClick} style={choiceStyle}>
      <span aria-hidden style={choiceArt}>{icon}</span>
      <span>{label}</span>
      {tag && <span data-testid={`${testId}-tag`} style={choiceTag}>{tag}</span>}
    </ActionButton>
  );
}

export function PlanetImportWindow(
  { open: openProp, onClose, onPickFile, canEdit, session = planetScan, takesHandedFiles = false }: PlanetImportWindowProps,
) {
  const t = useT();
  const { open, close: closeWindow } = useWindow('planetImport', { open: openProp, onClose });
  const locale = useLocale();
  // The guide and the progress stand their two parts one above the other in one column.
  const stacked = useRoomColumns(STACK_BELOW_ROOM) === 1;
  const scan = useSyncExternalStore(session.subscribe, session.snapshot);
  const [entry, setEntry] = useState<Entry>('choose');
  /** The planet read stands in the progress picture for a moment before the editor opens. */
  const [standing, setStanding] = useState(false);
  /** The held planet waits for the planet editor: it was refused, or was read by an earlier window. */
  const [waiting, setWaiting] = useState(() => session.snapshot().held !== null);
  const finishing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopStanding = () => {
    if (finishing.current !== null) clearTimeout(finishing.current);
    finishing.current = null;
    setStanding(false);
  };
  const reduced = useReducedMotionConfig() === true;
  // A planet just read keeps the progress on screen until it is handed to the editor; one that
  // waits for the editor is offered again, and is kept while the window is closed.
  const step = scan.reading ? 'scanning' : scan.held ? (waiting ? 'read' : 'scanning') : entry;
  const failure = scan.failure;
  // Closing stops a read in flight; each opening mounts a fresh window (its opener keys it).
  useEffect(() => {
    if (open) return;
    stopReading(session);
    stopStanding();
  }, [open, session]);
  useEffect(() => () => { stopReading(session); if (finishing.current !== null) clearTimeout(finishing.current); }, [session]);

  const body = useSizeGlide<HTMLDivElement>({ change: `${open}|${step}|${failure}|${locale}|${stacked}`, axis: 'height', motionId: 'modal.resize' });

  // The editor opens before the window closes, so a refusal keeps the planet for another try.
  const hand = () => {
    if (session.openHeld()) closeWindow();
    else setWaiting(true);
  };

  // The planet read takes the picture's place for as long again as it takes to appear, then opens.
  const show = () => {
    if (reduced) { hand(); return; }
    setStanding(true);
    finishing.current = setTimeout(() => {
      finishing.current = null;
      setStanding(false);
      hand();
    }, 2 * seconds('scan.preview.finish') * 1000);
  };

  const read = async (file: File) => {
    setWaiting(false);
    const ended = await session.read(file);
    if (ended === 'read') show();
    else if (ended === 'failed') setEntry('guide');
  };

  const cancel = () => {
    session.cancel();
    stopStanding();
    setEntry('guide');
  };

  const close = () => { stopReading(session); stopStanding(); setWaiting(true); closeWindow(); };

  /** A video is read here, a planet file goes to Change Planet, a map file gets the card offering
   *  Import map; the last card's file stays while the card leaves. */
  const flow = useImportFlow({ routing: ROUTING, onVideo: (file) => { void read(file); }, onRefused: () => showToast(t('planet.import_unknown'), 'error') });
  const redirect = flow.redirect;
  const lastRedirect = useRef<HandedImport | null>(null);
  if (redirect) lastRedirect.current = redirect;

  /** Only the chooser and the guide take a file; the session reads one at a time. */
  const route = async (file: File) => {
    if (step !== 'choose' && step !== 'guide') return;
    await flow.take(file);
  };

  // A video handed over by the page's drop or by Import map starts reading at once.
  useHandedImport('video', takesHandedFiles && open, (file) => { void read(file); });

  const redirectContent = useRedirectContent({
    hand: redirect ?? lastRedirect.current ?? { kind: 'map', file: new File([], '') },
    onCancel: flow.dismiss,
    onGone: flow.dismiss,
  });

  /** Drops anywhere on the window; the guide's drop zone hands its own to `route` too. */
  const dragOver = (e: DragEvent) => { if (carriesFiles(e)) e.preventDefault(); };
  const drop = (e: DragEvent) => {
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    e.preventDefault();
    void route(file);
  };

  // While the video is read the backdrop drops its blur for a deeper dim: the blur is redrawn with
  // every progress change and, without graphics acceleration, takes the time the decoder needs.
  const backdropStyle: CSSProperties = {
    transition: cssMotion('modal.dim', ['background-color'], reduced),
    ...(step === 'scanning' ? { backdropFilter: 'none', WebkitBackdropFilter: 'none', background: OVERLAY_DIM_WORKING } : {}),
  };

  const title = step === 'choose' ? t('planet.import') : step === 'guide' || step === 'read' ? t('planet.scan_title') : t('planet.scan_progress_title');
  const width = step === 'choose' ? 520 : 820;

  return (
    <>
    <ModalShell helpTarget={{ page: 'planet' }} open={open} onClose={close} size="panel" width={width} cardStyle={cardStyle} backdropStyle={backdropStyle} ariaLabel={title}>
      <div ref={body.ref} data-testid="planet-import" style={body.gliding ? { ...windowColumn, overflow: 'hidden' } : windowColumn} onDragOver={dragOver} onDrop={drop}>
        <div style={{ ...windowColumn, position: 'relative' }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <PlanetStep key={step}>
              <WindowHeader reserve title={title}
                {...(step === 'guide' ? { back: { label: t('planet.back'), onPress: () => { session.cancel(); setEntry('choose'); }, 'data-testid': 'planet-import-back' } } : {})}
                close={{ label: t('hint.close'), onPress: close }}>
                {step !== 'choose' && step !== 'scanning' && <span data-testid="planet-import-beta" style={titleTag}>{t('app.beta')}</span>}
              </WindowHeader>
              <WindowBody>
                {step === 'choose' && (
                  <div style={{ display: 'flex', gap: 14 }}>
                    {SUPPORTS_JSON_FILES && onPickFile && (
                      <Choice testId="planet-import-file" icon={<ImportFileIcon />} label={t('planet.import_file')} onClick={() => { closeWindow(); onPickFile(); }} />
                    )}
                    <Choice testId="planet-import-video" icon={<VideoIcon />} label={t('planet.import_video')} tag={t('app.beta')} disabled={!canEdit} onClick={() => setEntry('guide')} />
                  </div>
                )}
                {step === 'guide' && <VideoImportGuide failure={failure} stacked={stacked} onFile={(f) => { void route(f); }} />}
                {step === 'scanning' && <VideoImportProgress progress={scan.progress} finished={standing ? scan.held?.template ?? null : null} stacked={stacked} />}
                {step === 'read' && (
                  <div role="alert" data-testid="scan-open-failed" style={{ ...roleFont('label'), color: skin.plateInk, textAlign: 'center', lineHeight: 1.45 }}>
                    {t('planet.scan_open_failed')}
                  </div>
                )}
              </WindowBody>
            </PlanetStep>
          </AnimatePresence>
        </div>
        <WindowFooter style={{ marginTop: 18 }}
          cancel={(
            <ActionButton appearance="tertiary" hoverFill={skin.inset} data-testid="planet-import-cancel" onClick={step === 'scanning' ? cancel : close}>
              {t('delete.cancel')}
            </ActionButton>
          )}
          primary={step === 'read' ? (
            <ActionButton appearance="primary" data-testid="planet-import-retry" onClick={hand}>
              {t('planet.scan_retry_open')}
            </ActionButton>
          ) : undefined}
        />
      </div>
    </ModalShell>
    <ConfirmationModal open={open && redirect !== null} helpTarget={{ page: 'planet' }} {...redirectContent} />
    </>
  );
}

export default PlanetImportWindow;
