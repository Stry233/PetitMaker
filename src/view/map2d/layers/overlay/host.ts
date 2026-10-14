/** What every overlay part reads from the layer that holds it. */
export interface OverlayHost {
  requestRender(): void;
  /** Screen px per world px; marks and dashes keep their screen size. */
  readonly viewZoom: number;
  /** Set once the renderer has destroyed the parts' Graphics; later calls draw nothing. */
  readonly disposed: boolean;
}
