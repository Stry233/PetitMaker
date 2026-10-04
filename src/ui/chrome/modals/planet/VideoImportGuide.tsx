/**
 * The video import's guide: the recording protocol beside a looping example recording, the reason
 * the last video was refused, and the drop zone that takes the next one.
 *
 * The example loads when the guide mounts, plays muted and loops; under reduced motion it rests on
 * its poster with a play button and plays only when asked.
 */
import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import type { ImportFailure } from '../../../../io/planet-scan/import-video';
import exampleMp4 from '../../../../assets/planet-scan/example.mp4';
import exampleWebm from '../../../../assets/planet-scan/example.webm';
import examplePoster from '../../../../assets/planet-scan/example-poster.jpg';
import { colors, interactionProfiles, radii } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { skin } from '../../../design/window-skin';
import { Disclosure } from '../../../primitives/Disclosure';
import { PlayIcon } from '../../../primitives/line-glyphs';
import { ImportDropZone } from '../import/ImportDropZone';
import { acceptsVideo, VIDEO_ACCEPT } from '../../../../io/import-kind';
import { SCAN_EXAMPLE_SIZE } from './scan-example';

/** The protocol, in order. */
const STEPS = [
  'planet.scan_step_window', 'planet.scan_step_region', 'planet.scan_step_zoom', 'planet.scan_step_rows', 'planet.scan_step_cover', 'planet.scan_step_upload',
] as const;

/** Each refusal's copy key; every locale defines each (`planet-import-window.test.tsx`). */
export const FAILURE_COPY = {
  framing: 'planet.scan_failed_framing',
  'not-map-view': 'planet.scan_failed_not_map_view',
  'region-load-off': 'planet.scan_failed_region_off',
  'different-zoom': 'planet.scan_failed_zoom',
  'too-little': 'planet.scan_failed_too_little',
  'too-long': 'planet.scan_failed_too_long',
  'too-fast': 'planet.scan_failed_too_fast',
  blurry: 'planet.scan_failed_blurry',
  'too-large': 'planet.scan_failed_too_large',
  'no-ground': 'planet.scan_failed_no_ground',
  unreadable: 'planet.scan_failed_unreadable',
  busy: 'planet.scan_failed_busy',
  failed: 'planet.scan_failed_failed',
} as const satisfies Record<ImportFailure, `planet.scan_failed_${string}`>;


const listStyle: CSSProperties = {
  ...roleFont('body'), color: skin.plateInk, margin: 0, paddingInlineStart: 22, display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.45,
};
const frameStyle: CSSProperties = {
  position: 'relative', width: '100%', aspectRatio: `${SCAN_EXAMPLE_SIZE.width} / ${SCAN_EXAMPLE_SIZE.height}`, borderRadius: radii.md, overflow: 'hidden',
  background: colors.frameDark, border: `1.5px solid ${skin.line}`, boxSizing: 'border-box',
};
const mediaStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const playStyle: CSSProperties = {
  position: 'absolute', insetInlineStart: '50%', top: '50%', width: 56, height: 56, margin: '-28px 0 0 -28px', borderRadius: '50%', border: 'none',
  background: skin.active, color: skin.ink, display: 'grid', placeItems: 'center', padding: 0, WebkitTapHighlightColor: 'transparent',
};
const failureStyle: CSSProperties = {
  ...roleFont('label'), color: colors.statusError, background: skin.inset, borderRadius: radii.md, padding: '10px 14px', lineHeight: 1.45,
};

function ExampleVideo() {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const ref = useRef<HTMLVideoElement>(null);
  const [asked, setAsked] = useState(false);
  const playing = !reduced || asked;
  const play = () => {
    setAsked(true);
    void ref.current?.play().catch(() => setAsked(false));
  };
  return (
    <div style={frameStyle} data-testid="scan-example">
      <video ref={ref} style={mediaStyle} muted loop playsInline autoPlay={!reduced} preload={reduced ? 'none' : 'auto'} poster={examplePoster}
        aria-label={t('planet.scan_example')} data-testid="scan-example-video">
        <source src={exampleWebm} type="video/webm" />
        <source src={exampleMp4} type="video/mp4" />
      </video>
      {!playing && (
        <motion.button type="button" {...interactionProfiles.tile} data-testid="scan-example-play" aria-label={t('planet.scan_play')} title={t('planet.scan_play')}
          style={playStyle} onClick={play}>
          <PlayIcon size={26} />
        </motion.button>
      )}
    </div>
  );
}

export function VideoImportGuide({ failure, stacked, onFile }: {
  /** Why the last video was refused, or null. */
  failure: ImportFailure | null;
  /** The protocol stands above the example where the window is narrow. */
  stacked: boolean;
  /** A dropped or picked file, a video or not. */
  onFile: (file: File) => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = () => { if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); } };
  const take = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    // A video among several files is the one taken; any other file goes to `onFile` to be routed.
    const files = Array.from(e.dataTransfer.files ?? []);
    const file = files.find(acceptsVideo) ?? files[0];
    if (file) onFile(file);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <input ref={fileRef} type="file" hidden accept={VIDEO_ACCEPT} data-testid="scan-file"
        onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) onFile(f); }} />
      <div style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: 20, alignItems: stacked ? 'stretch' : 'center' }}>
        <ol style={{ ...listStyle, flex: 1, minWidth: 0 }} data-testid="scan-steps">
          {STEPS.map((key) => <li key={key}>{t(key)}</li>)}
        </ol>
        <div style={{ flex: stacked ? 'none' : '0 0 46%', minWidth: 0 }}>
          <ExampleVideo />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {failure && (
          <Disclosure key={failure} motionId="section.expand">
            <div role="alert" data-testid="scan-failure" style={failureStyle}>{t(FAILURE_COPY[failure])}</div>
          </Disclosure>
        )}
      </AnimatePresence>
      <ImportDropZone dragOver={over} busy={false} label={t('planet.scan_drop')} onClick={pick}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={take} />
    </div>
  );
}
