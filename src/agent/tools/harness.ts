/**
 * Tools about the job rather than the map: the plan, replies the user sees, skills,
 * delegation, and the job's own history. The protocol tools (`core/protocol.ts`) have no `run`: the
 * loop or the executor answers them, and they are declared here so the model is offered them.
 */
import { SKILLS, type AgentSkill } from '../skills';
import { TOOL_DEFAULTS } from './defaults';
import { corners } from './geometry';
import { int, list, obj, oneOf, req, str } from './schema';
import { defineTool } from './spec';

export const updatePlanTool = defineTool({
  description: 'Set stages for substantial dependent work or when the user asks for a plan. Use short labels covering only requested outcomes. To report progress on an existing plan, send completedStages alone, the number of consecutive stages already finished. This updates progress without editing the map or running a scorecard. Compact tasks can be built directly.',
  input: obj({
    stages: list(obj({ label: req(str()) }), { minItems: 1 }),
    completedStages: int({ min: 0, description: 'Number of consecutive completed stages in the existing plan. Send without stages; verify existing work before marking it complete.' }),
  }),
  access: 'read',
});

export const suggestReplyTool = defineTool({
  // The inline composer fits about 30 Latin characters or 15 full-width glyphs.
  description: "When your closing message leaves ONE obvious next step (a yes/no offer, a single natural follow-up), call this with the short reply the user would most likely send, in the user's own language. It appears as a one-tap suggestion inside their reply box, which shows about 30 characters in a Latin script and about 15 in Chinese, Japanese or Korean and simply cuts off what does not fit — so keep it to a few words. Skip it whenever the next step is genuinely open.",
  input: obj({ reply: req(str({ description: 'The predicted user reply, verbatim-sendable. A few words: ~30 Latin characters, ~15 CJK.' })) }),
  access: 'read',
});

/** The skill catalogue as list_skills answers it: methods first, then style set pieces, a kind with no skill left out. */
function listSkills(): string {
  const group = (header: string, kind: AgentSkill['kind']): string[] => {
    const rows = Object.entries(SKILLS).filter(([, s]) => s.kind === kind).map(([name, s]) => `- ${name}: ${s.description}`);
    return rows.length > 0 ? [[header, ...rows].join('\n')] : [];
  };
  return [
    ...group('METHOD skills (transferable craft, compose with any request):', 'method'),
    ...group('STYLE set pieces (reference layouts for specific aesthetics):', 'style'),
  ].join('\n\n');
}

export const listSkillsTool = defineTool({
  description: 'List the available build playbooks (proven multi-step recipes for villages, hills, rivers…). Cheap — call it when the user asks for a composite scene.',
  input: obj({}),
  access: 'read',
  run: () => ({ isError: false, content: `Available skills:\n${listSkills()}\nUse load_skill to get the full playbook.` }),
});

export const loadSkillTool = defineTool({
  description: 'Load a technique or style reference from list_skills when relevant. Apply the parts that help the requested result; examples and optional features do not expand the task. Do not reload an already loaded skill.',
  input: obj({ name: req(str()) }),
  access: 'read',
  run(_deps, { name }) {
    const skill = SKILLS[name];
    return skill
      ? { isError: false, content: `${skill.body}\n\nApply only the techniques relevant to the user's request. Preserve existing work and explicit constraints. Examples, dimensions and optional stages are not additional tasks or mandatory score targets.`, detail: { skill: { name, kind: skill.kind, title: skill.title } } }
      : { isError: true, content: `Unknown skill "${name}". Call list_skills for the catalogue.` };
  },
});

const briefItems = (description: string) => list(str(), { maxItems: 8, description });

/** The helper this spawns runs its own writes in a fresh context, so this one approval covers that
 *  whole burst and is the only place a user in checkpoint oversight can decline it. */
export const delegateTaskTool = defineTool({
  description: 'Hand one region of a job of several regions to a helper: a sub-agent with a fresh context that builds on the same map and sees none of this conversation, so the brief must say everything it needs. Build the shared ground and paths yourself first. The helper edits only inside x1,y1..x2,y2 (inclusive corners, cut to the user\'s region when one is set) and cannot undo. A region of at most 1600 cells with no side over 56 is one place, built by a helper. A larger one, up to 72 on a side, is a district: it goes to a lead of its own, who plans it and briefs helpers for its places. Helpers briefed in the same turn work at the same time, so brief every region that is ready in one turn and give them bounds that do not overlap. The result gives a status (done, partial, capped or failed), how many write calls landed and how many were refused or reverted, what the region gained or lost, and the helper\'s report. Read it instead of inspecting the region again, and look only where it names a problem.',
  input: obj({
    label: str({ description: 'Short name shown to the user while the helper works, a few words, e.g. "north grove".' }),
    ...corners,
    goal: str({ description: 'The idea of the whole place in a sentence, then what this region is and the one thing that makes it memorable.' }),
    include: briefItems('What must be there, one short phrase each.'),
    preserve: briefItems('What must be kept as it is, one short phrase each.'),
    interfaces: str({ description: 'How the region meets its neighbours: entry cells, the ground level at its edges.' }),
    skills: list(oneOf(() => Object.keys(SKILLS)), { maxItems: 3, description: 'Skills the helper loads before it builds.' }),
    done: briefItems('Completion checks, one short phrase each.'),
  }),
  access: 'wide',
  example: 'label: "north grove", x1: 10, y1: 10, x2: 30, y2: 24, goal: "An oak grove around a small clearing."',
});

const historySteps = int({ min: 1, max: 10 });

/** `undo` and `redo` move the shared history, which holds the user's own edits below the job's
 *  undo floor, so both are wide. */
export const undoTool = defineTool({
  description: `Undo the last N edit steps (default ${TOOL_DEFAULTS.historySteps}). Each of your write tool calls is one step.`,
  input: obj({ steps: historySteps }),
  access: 'wide',
  run(deps, input) {
    const steps = input.steps ?? TOOL_DEFAULTS.historySteps;
    const exec = deps.getExecutor();
    // Undo reaches only the entries this job pushed; everything below the floor is the user's own.
    const room = Math.max(0, exec.historyDepth() - (deps.undoFloor?.() ?? 0));
    let n = 0;
    for (let i = 0; i < Math.min(steps, room); i++) if (exec.undoEdit()) n++;
    return { isError: false, content: `Undid ${n} step(s).` };
  },
});

export const redoTool = defineTool({
  description: `Redo the last N undone edit steps (default ${TOOL_DEFAULTS.historySteps}), like the editor Redo button.`,
  input: obj({ steps: historySteps }),
  access: 'wide',
  run(deps, input) {
    const steps = input.steps ?? TOOL_DEFAULTS.historySteps;
    const exec = deps.getExecutor();
    let n = 0;
    for (let i = 0; i < steps; i++) { if (!exec.redoEdit()) break; n++; }
    return { isError: false, content: `Redid ${n} step(s).` };
  },
});
