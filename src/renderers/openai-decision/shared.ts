/**
 * OpenAI Decisions 渲染器共用的响应形状说明（同 decision/shared.ts：集中一份，免得七门语言漂移）。
 */
import { OPENAI_DECISION_PATH } from '../../config/openai-decision.js';

const LINES = [
  `OpenAI Decisions: POST ${OPENAI_DECISION_PATH} — ordered questions about one shared input.`,
  'Answers come back in question order, each echoing its question name (null if unnamed).',
  'No text to parse and no streaming. Each answer is typed:',
  '  predicate -> probability                        chance the statement is true, 0..1',
  '  choice    -> choice, probabilities, confidence  choice is one of the values you supplied',
  '  score     -> score, probabilities, confidence   probability-weighted level index, from 0',
  '  refusal   -> (name only)                        the question was declined',
  'Images: pass input as a user message with an input_image part (base64 data: URL).',
];

/** 渲染成注释块。`comment` 是该语言的行注释符，`indent` 是每行前缀缩进。 */
export function openaiDecisionNote(comment = '//', indent = ''): string {
  return LINES.map((l) => `${indent}${comment} ${l}`).join('\n');
}
