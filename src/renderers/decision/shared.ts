/**
 * decision 渲染器共用的响应形状说明。
 *
 * 七门语言各复制一份必然漂移（改了 python 忘改 ruby，用户对着两份不一致的注释）。
 * 这里集中一份，按各语言的注释符与缩进渲染。
 */
import { DECISION_PATH } from '../../config/decision.js';

const LINES = [
  `Structured decision: POST ${DECISION_PATH} — every question is evaluated in parallel and in`,
  'isolation against the same state, and comes back typed. No text generation, nothing to parse.',
  'The answers{} map is keyed by your own question names; each answer holds its value under a',
  'key named after its type:',
  '  noul   -> { type, noul }                                      probability of "yes", 0..1',
  '  choice -> { type, choice, probabilities, confidence }          choice is one of your criteria keys',
  '  score  -> { type, score, legend, probabilities, confidence }   legend maps level index -> description',
  'usage carries input_tokens / output_tokens.',
];

/** 渲染成注释块。`comment` 是该语言的行注释符，`indent` 是每行前缀缩进。 */
export function decisionNote(comment = '//', indent = ''): string {
  return LINES.map((l) => `${indent}${comment} ${l}`).join('\n');
}
