/**
 * Tools about the job rather than the map: the plan, replies and export the user sees, skills,
 * delegation, and the job's own history. The protocol tools (`core/protocol.ts`) have no `run`: the
 * loop or the executor answers them, and they are declared here so the model is offered them.
 */
import { SKILLS, type AgentSkill } from '../skills';
import { TOOL_DEFAULTS } from './defaults';
import { int, list, obj, oneOf, req, str } from './schema';
import { defineTool } from './spec';

export const updatePlanTool = defineTool({
  description: 'Set stages for substantial dependent work or when the user asks for a plan. Use short labels covering only requested outcomes. To report progress on an existing plan, send completedStages alone, the number of consecutive stages already finished. This updates progress without editing the map or running a scorecard. Compact tasks can be built directly.',
  input: obj({
    stages: list(obj({ label: req(str()) }), { minItems: 1 }),
    completedStages: int({ min: 0, description: 'Number of consecutive completed stages in the existing plan. Send without stages; verify existing work before marking it complete.' }),
  }),
  access: 'read',
  // The plan is the parent's progress surface in the panel header, which a helper would clobber.
  parentOnly: true,
});

export const exportMapTool = defineTool({
  description: "Open the export flow for the user to save their map: kind 'image' (a shareable PNG with the visible share-code band) or 'json' (the sectioned project file). This opens the export dialog for the user to confirm and download — you do not receive the file. Use only when the user asks to export, save, or share their map.",
  input: obj({ kind: req(oneOf(['image', 'json'])) }),
  access: 'read',
  parentOnly: true,
  run(deps, { kind }) {
    if (!deps.requestExport) {
      return { isError: true, content: 'Export is only available in the live editor, not in this context.' };
    }
    deps.requestExport(kind);
    return { isError: false, content: `Opened the ${kind === 'json' ? 'JSON project' : 'share image'} export dialog for the user to review and download.` };
  },
});

export const suggestReplyTool = defineTool({
  // The inline composer fits about 30 Latin characters or 15 full-width glyphs.
  description: "When your closing message leaves ONE obvious next step (a yes/no offer, a single natural follow-up), call this with the short reply the user would most likely send, in the user's own language. It appears as a one-tap suggestion inside their reply box, which shows about 30 characters in a Latin script and about 15 in Chinese, Japanese or Korean and simply cuts off what does not fit — so keep it to a few words. Skip it whenever the next step is genuinely open.",
  input: obj({ reply: req(str({ description: 'The predicted user reply, verbatim-sendable. A few words: ~30 Latin characters, ~15 CJK.' })) }),
  access: 'read',
  parentOnly: true,
});

/** The skill catalogue as list_skills answers it: methods first, then style set pieces. */
function listSkills(): string {
  const methods = Object.entries(SKILLS).filter(([, s]) => s.kind === 'method');
  const styles = Object.entries(SKILLS).filter(([, s]) => s.kind === 'style');
  const fmt = ([name, s]: [string, AgentSkill]) => `- ${name}: ${s.description}`;
  return [
    'METHOD skills (transferable craft, compose with any request):',
    ...methods.map(fmt),
    '',
    'STYLE set pieces (reference layouts for specific aesthetics):',
    ...styles.map(fmt),
  ].join('\n');
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

/** The helper this spawns runs its own writes in a fresh context, so this one approval covers that
 *  whole burst and is the only place a user in checkpoint oversight can decline it. */
export const delegateTaskTool = defineTool({
  description: 'Spawn a focused sub-agent with a FRESH context to execute one well-scoped build task, and get back its summary. Use for big requests: split them into independent parts (e.g. "terrain the north hills", "build the village at (40,60)-(70,90)", "decorate the lakeshore") and delegate each. The sub-agent sees the live map but NOT this conversation — the task text must be self-contained (locations, sizes, style). While it works, the panel names it by `label` if you gave one, else by the first line of `task` — so give a short `label` whenever `task` runs longer than a few words.',
  input: obj({
    task: req(str({ description: 'Complete, self-contained instructions incl. coordinates/area and desired style.' })),
    label: str({ description: "Optional short name (a few words, e.g. \"north grove\") shown in the panel while the helper works. Omit only when task already reads as one." }),
  }),
  access: 'wide',
  // Delegation depth is capped at one.
  parentOnly: true,
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
    for (let i = 0; i < Math.min(steps, room); i++) if (exec.undo()) n++;
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
    for (let i = 0; i < steps; i++) { if (!exec.canRedo()) break; exec.redo(); n++; }
    return { isError: false, content: `Redid ${n} step(s).` };
  },
});
