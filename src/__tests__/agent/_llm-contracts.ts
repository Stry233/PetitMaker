/**
 * Checks the six model-authored copy contracts over a completed session log; the scripted CI actor and
 * the opt-in gateway test share it. Findings are data, not failures: a live model may miss a copy bound
 * without the harness being wrong.
 *
 * UI bounds:
 *   1 says line      point within about 90 characters; two lines before expansion
 *   2 summary        one to four sentences in a self-sizing receipt
 *   3 stage label    about 30 authored characters; 45 measured; wraps
 *   4 delegate task  `label ?? firstLine(task)`; sliced at 96; two lines
 *   5 suggest_reply  hard-clipped at about 30 Latin or 15 CJK characters
 *   6 quick answers  about 20 per pill; `GateOption.cap` about 40
 *
 * Only contract 5 truncates by script; the other bounds count characters.
 */
import { eventsOf, type SessionLog } from '../../agent/core/log';
import type { SessionEvent } from '../../agent/core/types';

export interface ContractFinding {
  /** Which of the six, by number and name. */
  contract: string;
  /** What the model wrote, capped for a report. */
  text: string;
  /** The measurement and the bound, in the terms the contract states. */
  measured: string;
}

/** The bounds a report measures against. */
export const CONTRACTS = {
  saysPoint: 90,
  summarySentencesMax: 4,
  stageLabel: 45,
  delegateLabel: 96,
  suggestLatin: 30,
  suggestCjk: 15,
  quickAnswer: 20,
  optionCap: 40,
} as const;

const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
/** A sentence end in Latin or CJK punctuation. */
const SENTENCE_END = /[.!?。！？]/g;

function isCjk(text: string): boolean {
  return CJK.test(text);
}

/** The character budget for a string: a CJK glyph is a full em, about two Latin characters wide. */
function roomFor(text: string, latin: number, cjk: number): number {
  return isCjk(text) ? cjk : latin;
}

/** Where the first sentence ends, or -1 for a string that never finishes one. */
function firstSentenceEnd(text: string): number {
  SENTENCE_END.lastIndex = 0;
  const m = SENTENCE_END.exec(text);
  return m ? m.index : -1;
}

function countSentences(text: string): number {
  return (text.match(SENTENCE_END) ?? []).length;
}

function say(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

type Assistant = Extract<SessionEvent, { kind: 'assistant' }>;

/** Reports every model-authored string in a finished log that breaks its contract; contract 2 reads
 *  the closing summary, the only text the receipt sizes itself to. */
export function checkContracts(log: SessionLog): ContractFinding[] {
  const out: ContractFinding[] = [];
  const events = eventsOf(log);

  for (const ev of events) {
    if (ev.kind === 'assistant') {
      checkSays(ev, out);
      checkCalls(ev, out);
      continue;
    }
    if (ev.kind === 'plan') {
      for (const stage of ev.stages) {
        if (stage.label.length > CONTRACTS.stageLabel) {
          out.push({
            contract: '3 stage label',
            text: say(stage.label),
            measured: `${stage.label.length} chars, one rail row holds ~${CONTRACTS.stageLabel}`,
          });
        }
      }
      continue;
    }
    if (ev.kind === 'gateAsked') {
      for (const answer of ev.quickAnswers ?? []) {
        if (answer.length > CONTRACTS.quickAnswer) {
          out.push({
            contract: '6 quick answer',
            text: say(answer),
            measured: `${answer.length} chars, a pill reads as a choice at ~${CONTRACTS.quickAnswer}`,
          });
        }
      }
      for (const option of ev.options ?? []) {
        if (option.cap.length > CONTRACTS.optionCap) {
          out.push({
            contract: '6 option cap',
            text: say(option.cap),
            measured: `${option.cap.length} chars, the card's line holds ~${CONTRACTS.optionCap}`,
          });
        }
      }
      continue;
    }
    if (ev.kind === 'jobEnd' && ev.summary !== undefined) {
      const sentences = countSentences(ev.summary);
      if (ev.summary.trim() === '' || sentences > CONTRACTS.summarySentencesMax) {
        out.push({
          contract: '2 summary',
          text: say(ev.summary),
          measured: `${sentences} sentences, the receipt is drawn for 1-${CONTRACTS.summarySentencesMax}`,
        });
      }
    }
  }
  return out;
}

function checkSays(ev: Assistant, out: ContractFinding[]): void {
  for (const part of ev.parts) {
    if (part.kind !== 'text') continue;
    const text = part.text.trim();
    if (text === '') continue;
    // The line is clamped to two lines and expands on a tap, so the first sentence is measured, not the
    // whole say.
    const end = firstSentenceEnd(text);
    const point = end === -1 ? text.length : end + 1;
    if (point > CONTRACTS.saysPoint) {
      out.push({
        contract: '1 says line',
        text: say(text),
        measured: `the point lands at ${point} chars, the clamped line shows ~${CONTRACTS.saysPoint}`,
      });
    }
  }
}

function checkCalls(ev: Assistant, out: ContractFinding[]): void {
  for (const part of ev.parts) {
    if (part.kind !== 'tool') continue;
    if (part.name === 'suggest_reply') {
      const reply = typeof part.input.reply === 'string' ? part.input.reply.trim() : '';
      const room = roomFor(reply, CONTRACTS.suggestLatin, CONTRACTS.suggestCjk);
      if (reply.length > room) {
        out.push({
          contract: '5 suggest_reply',
          text: say(reply),
          measured: `${reply.length} chars in a field that CLIPS at ~${room}`
            + `${isCjk(reply) ? ' (CJK, a glyph is a full em)' : ''}`,
        });
      }
      continue;
    }
    if (part.name === 'delegate_task') {
      const label = typeof part.input.label === 'string' ? part.input.label.trim() : '';
      const task = typeof part.input.task === 'string' ? part.input.task : '';
      // The lane shows `label ?? firstLine(task)`, so an unlabelled task's first line is held to the
      // label bound.
      const shown = label !== '' ? label : (task.split('\n')[0] ?? '');
      if (shown.trim() === '') {
        out.push({ contract: '4 delegate label', text: say(task), measured: 'the lane would have no name at all' });
      } else if (shown.length > CONTRACTS.delegateLabel) {
        out.push({
          contract: '4 delegate label',
          text: say(shown),
          measured: `${shown.length} chars, the lane's name is sliced at ${CONTRACTS.delegateLabel}`,
        });
      }
    }
  }
}

/** Format findings for the gateway harness console. */
export function reportContracts(findings: readonly ContractFinding[]): string {
  if (findings.length === 0) return 'every model-authored string wore its designed shape';
  return findings.map((f) => `- [${f.contract}] ${f.measured}\n    "${f.text}"`).join('\n');
}
