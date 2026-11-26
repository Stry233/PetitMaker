import type { PlayBeat } from '../../../shared/viewport/frame-loop';

/** What every overlay part reads from the layer that holds it. */
export interface OverlayHost {
  requestRender(): void;
  /** Plays a part's beat on the owning renderer's frame loop. */
  readonly play: PlayBeat;
  /** Screen px per world px; marks and dashes keep their screen size. */
  readonly viewZoom: number;
  /** Set once the renderer has destroyed the parts' Graphics; later calls draw nothing. */
  readonly disposed: boolean;
}
