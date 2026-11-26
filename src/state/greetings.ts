/**
 * When a visit's greetings may speak, and which one: What's new, the arrival notice and the menu's
 * speech bubbles share one gate, and the bubbles one ladder. A greeting never competes: it waits
 * behind the splash, the tour and its unanswered offer, What's new (which speaks first) and a
 * landmark repair, whose window or plate stands where it would. The saved-session offer is not a
 * gate: it asks whether to pick the last map back up, while a greeting says which planet is under
 * you, and both are true at once.
 *
 * What's new reads its notes out of the changelog here (`notesSince`, `whatsNewDue`); the text comes
 * in as an argument, since the changelog's owner ranks above this layer.
 *
 * The brush pointer's record (the `brushHintSeen` pref) lives here too: opening the brush bar
 * (`slices/edit.ts:setObjectBrushBar`) or closing the pointer marks it seen.
 */
import { createSignal } from '../core/base/signal';
import { prefStorageAvailable, readPref, writePref } from '../platform/storage/prefs';
import { anyModalOpen } from './slices/shell';
import type { EditorStore } from './store';
import type { TourStanding } from './tour-offer';

/** What a greeting waits on that the store does not hold. */
export interface GreetingOutside {
  /** The boot splash still covers the app. */
  splashActive: boolean;
  /** The offer of this build's tour has been answered: the tour started, or it was waived. Until
   *  then a visit may be a frame away from opening the tour. */
  tourSettled: boolean;
}

type GateFields = Pick<EditorStore, 'tourRunning' | 'modals' | 'repairSession'>;

/** Whether a greeting may be said right now. */
export function greetingGate(s: GateFields, outside: GreetingOutside): boolean {
  return !outside.splashActive
    && !s.tourRunning
    && outside.tourSettled
    && !s.modals.whatsNew
    && s.repairSession === null;
}

/** Whether the visitor has set to work on a surface they chose: `chosen` (a mode or the menu) open,
 *  the assistant, or any window but What's new. Nothing counts while the tour runs, since what its
 *  Show me opens is not the visitor's choice. */
export function shellEngagedIn(s: Pick<EditorStore, 'tourRunning' | 'assistantOpen' | 'modals'>, chosen: boolean): boolean {
  return !s.tourRunning && (chosen || s.assistantOpen || anyModalOpen(s, 'whatsNew'));
}

/** Whether the saved-session offer may show in the shelf band: the tour holds it back until its run
 *  ends, and it gives way to the assistant's panel, What's new, a planet session's frame
 *  (`inSession`) and a landmark repair asked or under way. Showing is not declining: the offer still
 *  stands behind each of them (`editor/session/restore.ts`). */
export function restoreOfferShown(
  s: Pick<EditorStore, 'tourRunning' | 'assistantOpen' | 'modals' | 'repairSession'>, outside: { inSession: boolean },
): boolean {
  return !s.tourRunning && !s.assistantOpen && !s.modals.whatsNew && !outside.inSession && s.repairSession === null;
}

/** What What's new does as the visit's greetings come up: a first visit records the version and
 *  says nothing, since the tour is that visitor's welcome; a visit offering a returning browser a
 *  newer tour says nothing and records nothing, so the notes wait for its next visit; otherwise it
 *  waits until a greeting may speak and no window stands, then greets. */
export function whatsNewStep(standing: TourStanding, s: GateFields, outside: GreetingOutside): 'record' | 'skip' | 'wait' | 'greet' {
  if (standing === 'never') return 'record';
  if (standing === 'older') return 'skip';
  return greetingGate(s, outside) && !anyModalOpen(s) ? 'greet' : 'wait';
}

/** One release's notes out of the changelog. */
export interface ReleaseNotes {
  /** `unreleased` until `notesSince` stands the current build in for it. */
  version: string;
  heading: string;
  /** The Markdown under the heading. */
  body: string;
}

const UNRELEASED = /^\[?(Unreleased|未发布)\]?/i;

/** Every `## ` section of the changelog in file order, which is newest first; the preamble is dropped. */
function releaseSections(markdown: string): ReleaseNotes[] {
  return markdown.split(/^## /m).slice(1).map((part) => {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = nl === -1 ? '' : part.slice(nl + 1).trim();
    const numbered = /^\[?v?(\d+\.\d+\.\d+)/.exec(heading);
    const version = UNRELEASED.test(heading) ? 'unreleased' : numbered ? numbered[1]! : heading;
    return { version, heading, body };
  });
}

/** Numeric order on `major.minor.patch`; a `-dev` suffix does not count. */
function compareVersions(a: string, b: string): number {
  const nums = (v: string) => v.replace(/-.*$/, '').split('.').map((n) => Number(n) || 0);
  const [x, y] = [nums(a), nums(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** A section says something only when it lists an item; a placeholder line alone does not. */
function hasNotes(body: string): boolean {
  return body.split('\n').some((line) => /^[-*] /.test(line.trim()));
}

/**
 * The sections newer than the version this browser last saw, newest first. The unreleased section
 * stands for the current build. With no version on record only the newest section is owed.
 */
export function notesSince(markdown: string, lastSeen: string | null, current: string): ReleaseNotes[] {
  const sections = releaseSections(markdown)
    .map((s) => (s.version === 'unreleased' ? { ...s, version: current, heading: current } : s))
    .filter((s) => hasNotes(s.body));
  if (lastSeen === null) return sections.slice(0, 1);
  return sections.filter((s) => compareVersions(s.version, lastSeen) > 0);
}

/** Whether What's new opens: a returning browser, a version it has not seen, and notes in
 *  `changelog` (the bundled changelog's text in the reader's language) newer than the one it saw. */
export function whatsNewDue(f: { returning: boolean; lastSeen: string | null; current: string; changelog: string }): boolean {
  return f.returning && f.lastSeen !== f.current && notesSince(f.changelog, f.lastSeen, f.current).length > 0;
}

/** The menu's speech bubbles, in the order they take turns. */
type MenuBubble = 'load' | 'help' | 'immersive' | 'brush';

/** Whether the menu's bubbles may speak: a greeting may, no window is open, no scanned planet's
 *  review chip stands under the nameplate (where a bubble from the menu can reach in a narrow window),
 *  and the arrival notice does not cover the band a bubble points into (`arrivalCovers`). */
export function bubblesReleased(
  s: GateFields & Pick<EditorStore, 'planetSession'>, outside: GreetingOutside, arrivalCovers: boolean,
): boolean {
  return !anyModalOpen(s) && !s.planetSession?.review && !arrivalCovers && greetingGate(s, outside);
}

/** What each bubble is owed. */
export interface BubbleOwed {
  load: boolean;
  /** A tour has just ended. */
  help: boolean;
  /** A touch device that could go immersive and has not been invited this visit. */
  immersive: boolean;
  /** The brush pointer is owed and the brush button stands usable with its bar shut. */
  brush: boolean;
}

/** The one bubble that speaks: the region-load notice, then the pointer to Help, the immersive
 *  invitation, the brush pointer; null when none is owed. */
export function menuBubble(owed: BubbleOwed): MenuBubble | null {
  if (owed.load) return 'load';
  if (owed.help) return 'help';
  if (owed.immersive) return 'immersive';
  return owed.brush ? 'brush' : null;
}

const brushHint = createSignal();

/** True until the brush pointer was seen; false where storage cannot be read, which could not remember it. */
export function brushHintOwed(): boolean {
  return prefStorageAvailable() && !readPref('brushHintSeen');
}

export function subscribeBrushHint(listener: () => void): () => void {
  return brushHint.subscribe(listener);
}

/** Records the brush pointer seen, for good in this browser. */
export function markBrushHintSeen(): void {
  if (!brushHintOwed()) return;
  writePref('brushHintSeen', true);
  brushHint.emit();
}
