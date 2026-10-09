/**
 * OpenAI Decisions 请求体组装。
 *
 * **同源缝（single source seam）**：消费端发真实请求也要走 `buildOpenAIDecisionBody`，不允许
 * 旁路拼 body —— 理由同 wire/decision.ts。两个 decision 面各有各的 builder：body 形状不同
 * （见 config/openai-decision.ts 文件头），共用一个只会让两边互相牵制。
 */
import type { OpenAIDecisionCodeGenOpts, OpenAIDecisionQuestion } from '../types.js';
import {
  OPENAI_DECISION_INPUT_PLACEHOLDER,
  OPENAI_DECISION_PATH,
  OPENAI_DECISION_QUESTIONS_PLACEHOLDER,
} from '../config/openai-decision.js';
import { isUnset } from './gate.js';

/** OpenAI Decisions 请求上下文（贯穿各语言 renderer）。 */
export interface OpenAIDecisionCtx {
  /** 网关根地址（不带尾斜杠）。 */
  baseUrl: string;
  /** 端点路径。 */
  path: string;
  /** JSON body：{ model, input, questions }。 */
  bodyObj: Record<string, unknown>;
}

/**
 * 单题清洗：`type` 是判别器恒留；name / instructions / choices / levels 没填就不下发。
 * 键序固定（type → name → instructions → choices → levels），与实测请求同序，示例好读。
 * 不按题型删键：predicate 带了 choices 是调用方的错，交给上游 400 说清楚，包里不悄悄吞掉。
 */
function cleanQuestion(q: OpenAIDecisionQuestion): OpenAIDecisionQuestion {
  const out: OpenAIDecisionQuestion = { type: q.type };
  if (!isUnset(q.name)) out.name = q.name;
  if (!isUnset(q.instructions)) out.instructions = q.instructions;
  if (!isUnset(q.choices)) out.choices = q.choices;
  if (!isUnset(q.levels)) out.levels = q.levels;
  return out;
}

/**
 * 组装 OpenAI Decisions 请求体：`{ model, input, questions }`。
 * input / questions 缺省时退占位模板，保证「复制出来就能跑」。
 */
export function buildOpenAIDecisionBody(
  opts: Pick<OpenAIDecisionCodeGenOpts, 'modelId' | 'input' | 'questions'>,
): Record<string, unknown> {
  const input = isUnset(opts.input) ? OPENAI_DECISION_INPUT_PLACEHOLDER : opts.input;
  const raw = isUnset(opts.questions) ? OPENAI_DECISION_QUESTIONS_PLACEHOLDER : opts.questions!;
  return { model: opts.modelId, input, questions: raw.map(cleanQuestion) };
}

/** 组装 OpenAI Decisions 上下文（body 走 buildOpenAIDecisionBody，与真实请求同源）。 */
export function buildOpenAIDecisionCtx(opts: OpenAIDecisionCodeGenOpts): OpenAIDecisionCtx {
  return {
    baseUrl: opts.baseUrl,
    path: OPENAI_DECISION_PATH,
    bodyObj: buildOpenAIDecisionBody(opts),
  };
}
