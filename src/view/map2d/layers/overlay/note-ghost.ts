import * as PIXI from 'pixi.js-legacy';
import type { MapAnnotation } from '../../../../core/model/annotations';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { animConfig, easeOutQuad } from '../../../shared/motion/anim-config';
import { NOTE_GHOST_ALPHA } from '../../../shared/overlay/ghost-geometry';
import { TILE_SIZE } from '../../geometry/world';
import { AnnotationLayer } from '../annotation-layer';
import type { OverlayHost } from './host';

/** What the note ghost reads beyond the overlay host: the map's `annotationInkScale`. */
export interface NoteGhostHost extends OverlayHost {
  readonly noteInkScale: number;
}

/**
 * The note the next press would lay, drawn by a notes layer of its own at `NOTE_GHOST_ALPHA`.
 * Coalesced to one rebuild per frame like the cell ghost; it fades in on arrival
 * (`animConfig.noteGhost`), then follows the pointer and goes at once.
 */
export class OverlayNoteGhost {
  readonly noteSlot = new PIXI.Container();
  private readonly notes: AnnotationLayer;
  /** The latest ask: a note and its label, or null to take the ghost down. */
  private pending: { note: MapAnnotation; label: string } | null | undefined;
  private raf = 0;
  private fadeRaf = 0;

  constructor(private readonly host: NoteGhostHost) {
    this.notes = new AnnotationLayer(() => host.requestRender(), 0);
    this.noteSlot.addChild(this.notes.container);
    this.noteSlot.visible = false;
  }

  show(note: MapAnnotation, label: string): void {
    this.pending = { note, label };
    this.schedule();
  }

  clear(): void {
    this.pending = null;
    this.schedule();
  }

  /** Follows the view's zoom, so the ghost's lines are the width the note's will be. */
  rezoom(zoom: number): void {
    this.notes.setCellPixels(zoom * TILE_SIZE);
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.fadeRaf) cancelAnimationFrame(this.fadeRaf);
    this.raf = this.fadeRaf = 0;
    this.notes.destroy();
  }

  private schedule(): void {
    if (this.host.disposed || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const ask = this.pending;
      this.pending = undefined;
      if (ask === undefined) return;
      this.host.requestRender();
      if (ask === null) {
        this.endFade();
        this.noteSlot.visible = false;
        this.notes.draw(null, { draft: null, selectionIds: [], tagLabel: () => '', inkScale: this.host.noteInkScale });
        return;
      }
      this.notes.draw(null, {
        draft: ask.note, selectionIds: [], tagLabel: () => ask.label, inkScale: this.host.noteInkScale, zoneDimensions: false,
      });
      if (!this.noteSlot.visible) this.arrive();
    });
  }

  private arrive(): void {
    this.noteSlot.visible = true;
    if (isMotionReduced()) { this.noteSlot.alpha = NOTE_GHOST_ALPHA; return; }
    const start = performance.now();
    this.noteSlot.alpha = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / animConfig.noteGhost.fadeInMs);
      this.noteSlot.alpha = NOTE_GHOST_ALPHA * easeOutQuad(t);
      this.host.requestRender();
      this.fadeRaf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    this.fadeRaf = requestAnimationFrame(step);
  }

  private endFade(): void {
    if (this.fadeRaf) cancelAnimationFrame(this.fadeRaf);
    this.fadeRaf = 0;
  }
}
