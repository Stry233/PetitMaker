import { describe, expect, it } from 'vitest';
import { append, createLog } from '../../../agent/core/log';
import {
  BUDGET_WARN_AT,
  budgetWarning,
  callSignature,
  capMessage,
  consecutiveLengthStops,
  deliveryNudge,
  emptyTurnNudge,
  hasLandedWrite,
  landedWriteCount,
  lengthStopNudge,
  reasoningOnlyNudge,
  repeatedFailure,
  repeatRefusal,
  revertNudge,
  reviewNudge,
  REVIEW_MIN_TURNS_LEFT,
  verbatimRetryNudge,
} from '../../../agent/core/governor';

describe('callSignature', () => {
  it('is key-order independent', () => {
    const a = callSignature('paint_terrain', { x: 1, y: 2 });
    const b = callSignature('paint_terrain', { y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it('is value-sensitive', () => {
    const a = callSignature('paint_terrain', { x: 1, y: 2 });
    const b = callSignature('paint_terrain', { x: 1, y: 3 });
    expect(a).not.toBe(b);
  });

  it('is sensitive to the tool name too', () => {
    const a = callSignature('paint_terrain', { x: 1 });
    const b = callSignature('place_object', { x: 1 });
    expect(a).not.toBe(b);
  });
});

function seedOrder(log: ReturnType<typeof createLog>) {
  append(log, { kind: 'order', text: 'build a town', mapContext: '{}' });
}

function seedCall(
  log: ReturnType<typeof createLog>,
  callId: string,
  name: string,
  args: Record<string, unknown>,
) {
  append(log, {
    kind: 'assistant',
    parts: [{ kind: 'tool', callId, name, input: args, argsDone: true }],
    stop: 'tool-calls',
  });
}

function seedResult(
  log: ReturnType<typeof createLog>,
  callId: string,
  name: string,
  opts: { isError?: boolean; reverted?: boolean; write?: boolean; content?: string; repeatRefused?: boolean } = {},
) {
  const detail = {
    ...(opts.reverted ? { reverted: true as const } : {}),
    ...(opts.repeatRefused ? { damper: true as const, repeatRefused: true as const } : {}),
  };
  append(log, {
    kind: 'toolResult',
    callId,
    name,
    content: opts.content ?? (opts.isError ? 'boom' : 'ok'),
    isError: !!opts.isError,
    detail: Object.keys(detail).length > 0 ? detail : undefined,
    ...(opts.write !== undefined ? { write: opts.write } : {}),
  });
}

describe('verbatimRetryNudge', () => {
  const call = { name: 'paint_terrain', args: { x: 1, y: 2 } };

  it('returns undefined on a first failure', () => {
    const log = createLog();
    seedOrder(log);
    // No prior failure logged at all: this call has not failed yet, so there is nothing to escalate.
    expect(verbatimRetryNudge(log, call)).toBeUndefined();
  });

  it('returns an escalation naming a way out when the same signature already failed once', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'call-1', call.name, call.args);
    seedResult(log, 'call-1', call.name, { isError: true });
    const nudge = verbatimRetryNudge(log, call);
    expect(nudge).toBeDefined();
    expect(nudge).toMatch(/^\(system\)/);
    expect(nudge).toMatch(/find_|load_skill|ask the user/);
  });

  it('counts a detail.reverted result as a failure too', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'call-1', call.name, call.args);
    seedResult(log, 'call-1', call.name, { reverted: true });
    seedCall(log, 'call-2', call.name, call.args);
    seedResult(log, 'call-2', call.name, { reverted: true });
    expect(verbatimRetryNudge(log, call)).toBeDefined();
  });

  it('a success in between resets nothing: two failures anywhere in the job still escalate', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'call-1', call.name, call.args);
    seedResult(log, 'call-1', call.name, { isError: true });
    seedCall(log, 'call-2', call.name, call.args);
    seedResult(log, 'call-2', call.name, {}); // success
    seedCall(log, 'call-3', call.name, call.args);
    seedResult(log, 'call-3', call.name, { isError: true });
    expect(verbatimRetryNudge(log, call)).toBeDefined();
  });

  it('a reused callId across turns never corrupts the lookup: the new occurrence\'s first attempt reads clean while the earlier occurrence\'s real failure still counts', () => {
    const log = createLog();
    seedOrder(log);
    // Turn 1: call id "c" fails with {x:1}.
    seedCall(log, 'c', call.name, { x: 1 });
    seedResult(log, 'c', call.name, { isError: true });
    // Turn 2 REUSES id "c" with different args {x:2}: a raw-callId-keyed map (last write wins)
    // would overwrite {x:1}'s signature with {x:2}'s and misattribute turn 1's failure to it,
    // false-firing on this occurrence's very first attempt.
    seedCall(log, 'c', call.name, { x: 2 });

    // {x:2} has never failed: no false fire from the stale {x:1} mapping.
    expect(verbatimRetryNudge(log, { name: call.name, args: { x: 2 } })).toBeUndefined();
    // {x:1} genuinely failed once already: a second attempt at it still correctly escalates.
    expect(verbatimRetryNudge(log, { name: call.name, args: { x: 1 } })).toBeDefined();
  });

  it('a different signature never contributes to the count', () => {
    const log = createLog();
    seedOrder(log);
    // Only a MISMATCHED-args failure is logged: if it wrongly counted toward `call`'s own
    // signature, one prior would be enough to fire under the new threshold, so this fails loudly
    // on a broken signature match rather than needing a second, correctly-matching failure to
    // tell contamination apart from a legitimate count.
    seedCall(log, 'call-1', call.name, { x: 9, y: 9 });
    seedResult(log, 'call-1', call.name, { isError: true });
    expect(verbatimRetryNudge(log, call)).toBeUndefined();
  });
});

describe('revertNudge', () => {
  it('returns undefined before the second revert of one tool', () => {
    const log = createLog();
    seedOrder(log);
    // No revert logged yet for this tool: nothing has reverted once, so there is nothing to escalate.
    expect(revertNudge(log, 'paint_terrain')).toBeUndefined();
  });

  it('returns the change-strategy text at the 2nd revert of one tool', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'call-1', 'paint_terrain', { x: 1 });
    seedResult(log, 'call-1', 'paint_terrain', { reverted: true });
    seedCall(log, 'call-2', 'paint_terrain', { x: 2 });
    seedResult(log, 'call-2', 'paint_terrain', { reverted: true });
    const nudge = revertNudge(log, 'paint_terrain');
    expect(nudge).toBeDefined();
    expect(nudge).toMatch(/^\(system\)/);
    expect(nudge).toMatch(/strategy/);
    expect(nudge).not.toMatch(/coordinate/);
  });

  it('escalates to the STOP register from the 4th revert of one tool', () => {
    const log = createLog();
    seedOrder(log);
    for (let i = 1; i <= 4; i++) {
      seedCall(log, `call-${i}`, 'place_object', { x: i });
      seedResult(log, `call-${i}`, 'place_object', { reverted: true });
    }
    const nudge = revertNudge(log, 'place_object');
    expect(nudge).toMatch(/STOP: 4 place_object/);
    expect(nudge).toMatch(/inspect_region or view_map/);
  });

  it('a plain error (not reverted) never counts toward the revert damper', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'call-1', 'paint_terrain', { x: 1 });
    seedResult(log, 'call-1', 'paint_terrain', { isError: true });
    seedCall(log, 'call-2', 'paint_terrain', { x: 2 });
    seedResult(log, 'call-2', 'paint_terrain', { isError: true });
    expect(revertNudge(log, 'paint_terrain')).toBeUndefined();
  });

  it('reverts on a different tool name do not count toward this one', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'call-1', 'place_object', { x: 1 });
    seedResult(log, 'call-1', 'place_object', { reverted: true });
    seedCall(log, 'call-2', 'place_object', { x: 2 });
    seedResult(log, 'call-2', 'place_object', { reverted: true });
    expect(revertNudge(log, 'paint_terrain')).toBeUndefined();
  });
});

describe('repeatedFailure', () => {
  const call = { name: 'paint_terrain', args: { terrain: 'water', elevation: 2 } };

  it('is undefined when the call has never failed', () => {
    const log = createLog();
    seedOrder(log);
    expect(repeatedFailure(log, call)).toBeUndefined();
  });

  it('reports one repeat and echoes the failure text after an identical failure with nothing in between', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, call.args);
    seedResult(log, 'c1', call.name, { isError: true, write: false, content: 'Arguments: no cells given.' });
    expect(repeatedFailure(log, call)).toEqual({ error: 'Arguments: no cells given.', repeats: 1 });
  });

  it('a key-order variation of the same args joins the streak: the signature is canonicalized', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, { elevation: 2, terrain: 'water' });
    seedResult(log, 'c1', call.name, { isError: true });
    expect(repeatedFailure(log, call)).toBeDefined();
  });

  it('is undefined when the identical call last succeeded, even one that wrote nothing', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, call.args);
    seedResult(log, 'c1', call.name, { isError: true });
    seedCall(log, 'c2', call.name, call.args);
    seedResult(log, 'c2', call.name, { write: false });
    expect(repeatedFailure(log, call)).toBeUndefined();
  });

  it('is undefined once any successful write landed after the failure: the map changed', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, call.args);
    seedResult(log, 'c1', call.name, { isError: true, write: false });
    seedCall(log, 'w1', 'place_object', { catalogId: 'tree-oak', x: 4, y: 4 });
    seedResult(log, 'w1', 'place_object', { write: true });
    expect(repeatedFailure(log, call)).toBeUndefined();
  });

  it('a reverted write between the failures is not a map change: the streak stands', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, call.args);
    seedResult(log, 'c1', call.name, { isError: true, write: false });
    seedCall(log, 'w1', 'place_object', { catalogId: 'tree-oak', x: 4, y: 4 });
    seedResult(log, 'w1', 'place_object', { isError: true, reverted: true, write: true });
    expect(repeatedFailure(log, call)).toBeDefined();
  });

  it('still fires across an intervening successful read: a read changes nothing on the map', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, call.args);
    seedResult(log, 'c1', call.name, { isError: true, write: false });
    seedCall(log, 'r1', 'inspect_region', { x1: 0, y1: 0, x2: 9, y2: 9 });
    seedResult(log, 'r1', 'inspect_region', { write: false });
    expect(repeatedFailure(log, call)).toBeDefined();
  });

  it('a different signature never joins the streak', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, { terrain: 'water', elevation: 3 });
    seedResult(log, 'c1', call.name, { isError: true });
    expect(repeatedFailure(log, call)).toBeUndefined();
  });

  it('counts refused repeats into the streak and still echoes the executed failure\'s own error', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, call.args);
    seedResult(log, 'c1', call.name, { isError: true, content: 'Arguments: no cells given.' });
    seedCall(log, 'c2', call.name, call.args);
    seedResult(log, 'c2', call.name, { isError: true, repeatRefused: true, content: '(system) Not run: repeated.' });
    expect(repeatedFailure(log, call)).toEqual({ error: 'Arguments: no cells given.', repeats: 2 });
  });

  it('ignores failures from an earlier job', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, call.args);
    seedResult(log, 'c1', call.name, { isError: true });
    seedOrder(log);
    expect(repeatedFailure(log, call)).toBeUndefined();
  });

  it('counts a detail.reverted result as a failure too', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'c1', call.name, call.args);
    seedResult(log, 'c1', call.name, { reverted: true, write: true });
    expect(repeatedFailure(log, call)).toBeDefined();
  });
});

describe('repeatRefusal', () => {
  it('echoes the error and says an unchanged resend will not run', () => {
    const text = repeatRefusal({ error: 'Arguments: no cells given.', repeats: 1 });
    expect(text).toMatch(/^\(system\)/);
    expect(text).toMatch(/just failed/);
    expect(text).toContain('Arguments: no cells given.');
    expect(text).toMatch(/will not run/);
  });

  it('first repeat carries no look-around pointer; further repeats point at inspect_region or load_skill', () => {
    expect(repeatRefusal({ error: 'boom', repeats: 1 })).not.toMatch(/inspect_region|load_skill/);
    const escalated = repeatRefusal({ error: 'boom', repeats: 2 });
    expect(escalated).toMatch(/inspect_region/);
    expect(escalated).toMatch(/load_skill/);
    expect(repeatRefusal({ error: 'boom', repeats: 5 })).toBe(escalated);
  });

  it('contains no em dash', () => {
    expect(repeatRefusal({ error: 'boom', repeats: 2 })).not.toMatch(/—/);
  });
});

describe('job scoping', () => {
  it('events before the last order are ignored by the verbatim-retry damper', () => {
    const log = createLog();
    const call = { name: 'paint_terrain', args: { x: 1 } };
    seedOrder(log);
    seedCall(log, 'call-1', call.name, call.args);
    seedResult(log, 'call-1', call.name, { isError: true });
    // A new job starts with none of its OWN matching failures: at the new threshold (fires on 1
    // logged prior), the prior job's failure alone would be enough to wrongly escalate here if it
    // leaked across the order boundary, so this needs no second failure of its own to prove it.
    seedOrder(log);
    expect(verbatimRetryNudge(log, call)).toBeUndefined();
  });

  it('events before the last order are ignored by the revert damper', () => {
    const log = createLog();
    seedOrder(log);
    seedCall(log, 'call-1', 'paint_terrain', { x: 1 });
    seedResult(log, 'call-1', 'paint_terrain', { reverted: true });
    // A new job starts with no revert of its own: same reasoning as the verbatim-retry case above.
    seedOrder(log);
    expect(revertNudge(log, 'paint_terrain')).toBeUndefined();
  });
});

describe('budgetWarning', () => {
  it('fires exactly at the threshold', () => {
    const nudge = budgetWarning(35, 40);
    expect(nudge).toBeDefined();
    expect(nudge).toMatch(/^\(system\)/);
    expect(nudge).toMatch(new RegExp(String(BUDGET_WARN_AT)));
  });

  it('does not fire one turn before the threshold', () => {
    expect(budgetWarning(34, 40)).toBeUndefined();
  });

  it('does not fire one turn after the threshold', () => {
    expect(budgetWarning(36, 40)).toBeUndefined();
  });
});

describe('emptyTurnNudge', () => {
  it('returns the continue text for the 1st consecutive empty turn', () => {
    const nudge = emptyTurnNudge(1);
    expect(nudge).toBeDefined();
    expect(nudge).toMatch(/^\(system\)/);
  });

  it('returns the continue text for the 2nd consecutive empty turn', () => {
    expect(emptyTurnNudge(2)).toBeDefined();
  });

  it('returns undefined past 2', () => {
    expect(emptyTurnNudge(3)).toBeUndefined();
  });
});

describe('reasoningOnlyNudge', () => {
  it('returns nothing at 0: no silent turn to speak about yet', () => {
    expect(reasoningOnlyNudge(0)).toBeUndefined();
  });

  it('acknowledges the reasoning and asks for text or a tool call, for the 1st and 2nd silent turn', () => {
    for (const n of [1, 2]) {
      const nudge = reasoningOnlyNudge(n);
      expect(nudge).toBeDefined();
      expect(nudge).toMatch(/^\(system\) /);
      expect(nudge).toMatch(/reasoning/);
      expect(nudge).toMatch(/tool/);
    }
  });

  it('never tells a turn that thought it produced nothing: that is the empty nudge\'s sentence, and it would be false here', () => {
    expect(reasoningOnlyNudge(1)).not.toMatch(/produced no text and no tool calls/);
    expect(emptyTurnNudge(1)).toMatch(/produced no text and no tool calls/); // the two shapes stay distinct
  });

  it('returns nothing past 2, exactly as the empty nudge does: the loop ends the job rather than nudging again', () => {
    expect(reasoningOnlyNudge(3)).toBeUndefined();
  });

  it('contains no em dash', () => {
    expect(reasoningOnlyNudge(1)).not.toMatch(/—/);
  });
});

describe('consecutiveLengthStops', () => {
  function seedTurn(log: ReturnType<typeof createLog>, stop: 'length' | 'tool-calls' | 'stop') {
    append(log, { kind: 'assistant', parts: [{ kind: 'text', text: 'words', done: true }], stop });
  }

  it('is 0 with no assistant turn at all', () => {
    const log = createLog();
    seedOrder(log);
    expect(consecutiveLengthStops(log)).toBe(0);
  });

  it('counts the trailing run of length-stopped turns', () => {
    const log = createLog();
    seedOrder(log);
    seedTurn(log, 'length');
    expect(consecutiveLengthStops(log)).toBe(1);
    seedTurn(log, 'length');
    seedTurn(log, 'length');
    expect(consecutiveLengthStops(log)).toBe(3);
  });

  it('resets on any non-length assistant turn, however many length stops preceded it', () => {
    const log = createLog();
    seedOrder(log);
    seedTurn(log, 'length');
    seedTurn(log, 'length');
    seedTurn(log, 'tool-calls');
    expect(consecutiveLengthStops(log)).toBe(0);
    seedTurn(log, 'length');
    expect(consecutiveLengthStops(log)).toBe(1);
  });

  it('ignores an earlier job: a length streak does not carry across the order boundary', () => {
    const log = createLog();
    seedOrder(log);
    seedTurn(log, 'length');
    seedTurn(log, 'length');
    seedOrder(log);
    expect(consecutiveLengthStops(log)).toBe(0);
  });

  it('a non-assistant event between two length turns does not break the run', () => {
    const log = createLog();
    seedOrder(log);
    seedTurn(log, 'length');
    seedResult(log, 'call-1', 'paint_terrain', { isError: true }); // the reissue result of the cut-off batch
    seedTurn(log, 'length');
    expect(consecutiveLengthStops(log)).toBe(2);
  });
});

describe('lengthStopNudge', () => {
  it('returns nothing at a streak of 0: no turn has been cut off yet', () => {
    expect(lengthStopNudge(0)).toBeUndefined();
  });

  it('names the cut-off and a way out for the 1st and 2nd cut-off turn', () => {
    for (const streak of [1, 2]) {
      const nudge = lengthStopNudge(streak);
      expect(nudge).toBeDefined();
      expect(nudge).toMatch(/^\(system\) /);
      expect(nudge).toMatch(/cut off/);
      expect(nudge).toMatch(/smaller|shorter/);
    }
  });

  it('returns nothing past 2: the loop ends the job rather than nudging a fourth time', () => {
    expect(lengthStopNudge(3)).toBeUndefined();
  });

  it('contains no em dash', () => {
    expect(lengthStopNudge(1)).not.toMatch(/—/);
  });
});

describe('capMessage', () => {
  it('starts with (system) and names a way out', () => {
    const msg = capMessage();
    expect(msg).toMatch(/^\(system\)/);
    expect(msg.toLowerCase()).toMatch(/user/);
  });

  it('contains no em dash', () => {
    expect(capMessage()).not.toMatch(/—/);
  });
});

describe('hasLandedWrite', () => {
  it('is true only for a successful, unreverted write in the current job', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'build', mapContext: '' });
    seedResult(log, 'r1', 'inspect_region', { write: false });
    seedResult(log, 'w1', 'paint_terrain', { write: true, isError: true });
    seedResult(log, 'w2', 'paint_terrain', { write: true, reverted: true });
    expect(hasLandedWrite(log)).toBe(false);

    seedResult(log, 'w3', 'paint_terrain', { write: true });
    expect(hasLandedWrite(log)).toBe(true);
  });

  it('does not read a previous job\'s write as this one\'s delivery', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'build', mapContext: '' });
    seedResult(log, 'w1', 'paint_terrain', { write: true });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    append(log, { kind: 'order', text: 'build again', mapContext: '' });
    expect(hasLandedWrite(log)).toBe(false);
  });
});

describe('deliveryNudge', () => {
  it('starts with (system), asks for the build or a plain refusal, and says the next message is final', () => {
    const msg = deliveryNudge();
    expect(msg).toMatch(/^\(system\)/);
    expect(msg.toLowerCase()).toContain('deliver');
    expect(msg.toLowerCase()).toContain('cannot be done');
    expect(msg.toLowerCase()).toContain('final');
  });

  it('contains no em dash', () => {
    expect(deliveryNudge()).not.toMatch(/—/);
  });
});

describe('landedWriteCount', () => {
  it('counts only successful, unreverted writes in the current job', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'build', mapContext: '' });
    seedResult(log, 'r1', 'inspect_region', { write: false });
    seedResult(log, 'w1', 'paint_terrain', { write: true });
    seedResult(log, 'w2', 'paint_terrain', { write: true, isError: true });
    seedResult(log, 'w3', 'paint_terrain', { write: true, reverted: true });
    seedResult(log, 'w4', 'place_object', { write: true });
    expect(landedWriteCount(log)).toBe(2);
  });

  it('starts over with each order', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'build', mapContext: '' });
    seedResult(log, 'w1', 'paint_terrain', { write: true });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    append(log, { kind: 'order', text: 'build again', mapContext: '' });
    expect(landedWriteCount(log)).toBe(0);
  });
});

describe('reviewNudge', () => {
  it('sends the model back to the order: re-read it, judge only what it asked for, name the weakest thing, next close final', () => {
    const msg = reviewNudge();
    expect(msg).toMatch(/^\(system\)/);
    expect(msg.toLowerCase()).toContain('re-read the order');
    expect(msg.toLowerCase()).toContain('weakest');
    expect(msg.toLowerCase()).toContain('final');
  });

  it('forbids growing the scope, and makes a constrained or repair order a verification pass', () => {
    const msg = reviewNudge().toLowerCase();
    expect(msg).toContain('do not add anything the order did not ask for');
    expect(msg).toContain('exact counts');
    expect(msg).toContain('repair');
    expect(msg).toContain('verify');
  });

  it('points at view_map over the order\'s own ground, never at the whole-map scorecard', () => {
    const msg = reviewNudge();
    expect(msg).toContain('view_map');
    expect(msg).not.toContain('evaluate_map');
  });

  it('contains no em dash', () => {
    expect(reviewNudge()).not.toMatch(/—/);
  });

  it('needs more headroom than the budget warning leaves, so a job never holds both notes\' instructions at once', () => {
    expect(REVIEW_MIN_TURNS_LEFT).toBeGreaterThan(BUDGET_WARN_AT);
  });
});
