/**
 * decision 请求体组装。
 *
 * **同源缝（single source seam）**：消费端发真实请求也要走 `buildDecisionBody`，不允许旁路
 * 拼 body —— 否则「Get Code 里写的」与「点发送真发出去的」会各自演化，用户照抄得到的示例
 * 跑不通，而本地又永远测不出来。media 的 buildMediaCtx、realtime 的 buildRealtimeSession
 * 都是这么守的。
 */
import type { DecisionCodeGenOpts, DecisionQuestion } from '../types.js';
import {
  DECISION_PATH,
  DECISION_QUESTIONS_PLACEHOLDER,
  DECISION_STATE_PLACEHOLDER,
} from '../config/decision.js';
import { isEmptyContainer } from './gate.js';

/** decision 请求上下文（贯穿各语言 renderer）。 */
export interface DecisionCtx {
  /** 网关根地址（不带尾斜杠）。 */
  baseUrl: string;
  /** 端点路径。 */
  path: string;
  /** JSON body：{ model, state, questions }。 */
  bodyObj: Record<string, unknown>;
}

/** 「没填」判据：undefined / null / 空串 / 空容器。空容器那一半与 media 的 filterParams 同源
 *  （`isEmptyContainer`）——`{}` / `[]` 下发过去是**显式空值**，会覆盖默认行为，不是「没填」。 */
function unset(v: unknown): boolean {
  return v === undefined || v === null || v === '' || isEmptyContainer(v);
}

/** 单题清洗：`type` 是判别器恒留；instructions / criteria 没填就不下发。 */
function cleanQuestion(q: DecisionQuestion): DecisionQuestion {
  const out: DecisionQuestion = { type: q.type };
  if (!unset(q.instructions)) out.instructions = q.instructions;
  if (!unset(q.criteria)) out.criteria = q.criteria;
  return out;
}

/**
 * 组装 decision 请求体：`{ model, state, questions }`。
 * state / questions 缺省时退占位模板，保证「复制出来就能跑」。
 */
export function buildDecisionBody(
  opts: Pick<DecisionCodeGenOpts, 'modelId' | 'state' | 'questions'>,
): Record<string, unknown> {
  const state = unset(opts.state) ? DECISION_STATE_PLACEHOLDER : opts.state;
  const raw = unset(opts.questions) ? DECISION_QUESTIONS_PLACEHOLDER : opts.questions!;
  const questions = Object.fromEntries(
    Object.entries(raw).map(([key, q]) => [key, cleanQuestion(q)]),
  );
  return { model: opts.modelId, state, questions };
}

/** 组装 decision 上下文（body 走 buildDecisionBody，与真实请求同源）。 */
export function buildDecisionCtx(opts: DecisionCodeGenOpts): DecisionCtx {
  return {
    baseUrl: opts.baseUrl,
    path: DECISION_PATH,
    bodyObj: buildDecisionBody(opts),
  };
}
