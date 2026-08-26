/**
 * pretty-model.ts — friendly model names for the agent-v3 panel.
 *
 * Copied VERBATIM from `src/ui/agent/atoms.tsx`'s `prettyModel` (the legacy Site Log UI), which is
 * a read-only source here and never imported: the panel is its own module tree, and a shared
 * dependency between the two UIs would make a legacy-side edit reach here unannounced. Re-copy by
 * hand if the legacy function changes; `src/__tests__/ui/agent/pretty-model.test.ts` carries the
 * same cases as the legacy test, against this copy.
 */

/** Friendly model name: "claude-opus-4-8" → "Claude Opus 4 8",
 *  "gpt-5.5" → "GPT 5 5", "glm-4.6" → "GLM 4 6", "kimi-k2-…" → "Kimi K2 …"
 *  (K2 title-cases naturally; GPT/GLM need the acronym fixups). */
/** Fixed casings for tokens that Title Case would mangle. Derived from a
 *  cross-platform corpus (OpenAI, OpenRouter catalog, ollama gateways). */
const BRAND_CASE: Record<string, string> = {
  gpt: 'GPT', chatgpt: 'ChatGPT', oss: 'OSS', glm: 'GLM', vl: 'VL', ai: 'AI',
  tts: 'TTS', it: 'IT', moe: 'MoE', qwq: 'QwQ', deepseek: 'DeepSeek',
  openrouter: 'OpenRouter', llava: 'LLaVA', medgemma: 'MedGemma',
  codellama: 'CodeLlama', minimax: 'MiniMax', k2: 'K2',
};
/** Families whose glued version splits off: llama3.1 → llama 3.1. */
const GLUE_SPLIT = /^([a-z]{3,})(\d+(?:\.\d+)?)$/i;
const SIZE = /^\d+(?:\.\d+)?[bkm]$/i;          // 70b, 1.5b, 32k
const QUANT = /^(q\d+|fp\d+|int\d+|a\d+b)$/i;  // q4, fp16, int8, a4b (MoE actives)
const DATE_LONG = /^\d{6,}$/;                  // -20251001
const DATE_MMDD = /^(0[1-9]|1[0-2])\d{2}$/;    // -0125 / -1106 trailing snapshots
const VNUM = /^[vmr]\d+(?:\.\d+)?$/i;          // v1, m2.1, r1
const OSERIES = /^o\d$/;                       // OpenAI o1/o3/o4 stay lowercase-o
const INT12 = /^\d{1,2}$/;                     // dash-version parts (4-8 → 4.8)

/**
 * Friendly model name from any id shape the ten platforms emit. The mono id
 * always renders alongside it in menus, so this favors readability: vendor
 * prefixes and date snapshots drop, versions keep their dots (and dash
 * versions regain them), sizes/quants uppercase, brands keep their casing.
 */
export function prettyModel(id: string): string {
  const seg = id.split('/').pop() ?? id;
  // ollama/openrouter ":tag" folds into the token stream; ":latest" is noise
  const rawTokens = seg
    .split(/[:\-_]/)
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== 'latest');

  // drop date snapshots: one long token, or a split year + trailing pairs
  const tokens: string[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const tk = rawTokens[i]!;
    if (DATE_LONG.test(tk)) continue;
    if (/^(19|20)\d{2}$/.test(tk) && rawTokens.slice(i + 1).every((r) => /^\d{1,2}$/.test(r))) break;
    if (i === rawTokens.length - 1 && tokens.length > 0 && DATE_MMDD.test(tk)) continue;
    tokens.push(tk);
  }

  // split glued family+version (llama3.1 → llama, 3.1)
  const split: string[] = [];
  for (const tk of tokens) {
    const m = !SIZE.test(tk) && !QUANT.test(tk) ? GLUE_SPLIT.exec(tk) : null;
    if (m && !BRAND_CASE[tk.toLowerCase()]) split.push(m[1]!, m[2]!);
    else split.push(tk);
  }

  // join runs of small integers into dotted versions (opus, 4, 8 → opus, 4.8)
  const joined: string[] = [];
  for (const tk of split) {
    const prev = joined[joined.length - 1];
    if (INT12.test(tk) && prev !== undefined && /^\d{1,2}(\.\d{1,2})*$/.test(prev)) {
      joined[joined.length - 1] = `${prev}.${tk}`;
    } else {
      joined.push(tk);
    }
  }

  const words = joined.map((tk) => {
    const lo = tk.toLowerCase();
    if (BRAND_CASE[lo]) return BRAND_CASE[lo];
    if (OSERIES.test(lo)) return lo;                       // o3 stays o3
    if (SIZE.test(lo)) return lo.toUpperCase();            // 70B / 32K
    if (QUANT.test(lo)) return lo.toUpperCase();           // Q4 → uppercase family
    if (VNUM.test(lo)) return lo.toUpperCase();            // V1 / R1 / M2.1
    if (/^\d/.test(lo)) return lo;                         // bare versions: 4.8, 4o
    return lo.charAt(0).toUpperCase() + lo.slice(1);
  });

  const name = words.join(' ').replace(/\s+/g, ' ').trim();
  return name || seg || id;
}

/**
 * The same name with its trailing VERSION dropped: "Claude Sonnet 4.5" → "Claude Sonnet".
 *
 * For the one place a model name shares a line with a second fact and the line may not wrap: the
 * dock's meta deck on the manage face, where "Claude Sonnet 4.5, Checkpoint" ran past the card and
 * ellipsized the oversight word away. The exact id stands in full one row below, in the card's own
 * model row, so the summary above it can afford to be a summary.
 *
 * IT KEEPS TWO WORDS. A version is only noise where a family name survives without it: "GPT 5.1" cut
 * to "GPT" names no model at all.
 */
export function shortModel(id: string): string {
  const name = prettyModel(id);
  const cut = name.replace(/\s+\d[\d.]*$/, '');
  return cut.includes(' ') ? cut : name;
}
