import type { MapAnnotation } from '../../../../core/model/annotations';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { animConfig, easeOutQuad } from '../../../shared/motion/anim-config';
import { NOTE_GHOST_ALPHA } from '../../../shared/overlay/ghost-geometry';
import { AnnotationLayer3D } from '../annotation-layer';
import type { OverlayHost3D } from './host';

/**
 * The note the next press would lay, draped by a notes layer of its own at `NOTE_GHOST_ALPHA`.
 * Built in `flush()`, once per rendered frame, like the cell ghost; it fades in on arrival
 * (`animConfig.noteGhost`, stepped by `tick()`), then follows the pointer and goes at once.
 */
export class OverlayNoteGhost3D {
  readonly notes = new AnnotationLayer3D();
  /** The latest ask: a note and its label, or null to take the ghost down. */
  private pending: { note: MapAnnotation; label: string } | null | undefined;
  private shown = false;
  private fadeBornMs: number | null = null;

  constructor(private readonly host: OverlayHost3D) {
    this.notes.setStrength(NOTE_GHOST_ALPHA);
  }

  show(note: MapAnnotation, label: string): void {
    this.pending = { note, label };
    this.host.requestRender();
  }

  clear(): void {
    if (!this.shown && this.pending === undefined) return;
    this.pending = null;
    this.host.requestRender();
  }

  flush(): void {
    const ask = this.pending;
    this.pending = undefined;
    if (ask === undefined) return;
    if (ask === null) {
      this.shown = false;
      this.fadeBornMs = null;
      this.notes.update(this.host.state(), null, { draft: null, tagLabel: () => '' });
      return;
    }
    this.notes.update(this.host.state(), null, { draft: ask.note, selectionIds: [], tagLabel: () => ask.label, zoneDimensions: false });
    if (this.shown) return;
    this.shown = true;
    if (isMotionReduced()) { this.notes.setStrength(NOTE_GHOST_ALPHA); return; }
    this.fadeBornMs = this.host.nowMs();
    this.notes.setStrength(0);
    // The frame this flush runs in may already have read `tick()`; the fade needs the next one.
    this.host.requestRender();
  }

  /** Steps the arrival fade; true while it runs. */
  tick(): boolean {
    if (this.fadeBornMs === null) return false;
    const t = Math.min(1, (this.host.nowMs() - this.fadeBornMs) / animConfig.noteGhost.fadeInMs);
    this.notes.setStrength(NOTE_GHOST_ALPHA * easeOutQuad(t));
    if (t < 1) return true;
    this.fadeBornMs = null;
    return false;
  }

  dispose(): void {
    this.notes.dispose();
  }
}
