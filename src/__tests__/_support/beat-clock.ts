/** A view's frame loop for beats under test: `play` starts one, `frame(now)` steps every live beat at
 *  `now` ms and answers whether any still runs, `settle` lands them, as the 2D renderer's loop does,
 *  and `played` counts the beats started. */
import { Beats, type PlayBeat } from '../../view/shared/viewport/frame-loop';

export function beatClock() {
  const beats = new Beats(() => {});
  let played = 0;
  const play: PlayBeat = (beat) => { played++; return beats.play(beat); };
  return {
    play,
    frame: (now: number) => beats.step(now),
    settle: () => beats.settle(),
    get played() { return played; },
  };
}
