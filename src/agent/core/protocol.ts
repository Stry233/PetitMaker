/**
 * The harness protocol: the tools the loop or the executor answers itself. Core owns these names and
 * branches on them; `tools/harness.ts` declares their schemas under them, without a `run`.
 */
export const PROTOCOL = {
  /** Files or advances the job's plan; the loop appends the plan event at plan scope. */
  plan: 'update_plan',
  /** Offers a one-tap reply; the loop acknowledges it in place. */
  reply: 'suggest_reply',
  /** Spawns a helper job; the executor runs its child log. */
  delegate: 'delegate_task',
} as const;
