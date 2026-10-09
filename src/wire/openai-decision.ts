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
 * 单题清洗：`type` 是判别器恒留，键序固定（type → name → instructions → choices → levels），
 * 与实测请求同序，示例好读。两类字段两种判据：
 *  - 可选的 `name`：空串也算没填，不下发（表单里留空的名字框 = 不命名，答案回显 null）；
 *  - 上游必填的 `instructions`（三种题型）/ `choices`（choice）/ `levels`（score）：只有没提供
 *    （undefined / null）才不下发，空串、空数组**原样下发**。spec 允许空串 instructions，删掉
 *    反而把合法请求变成缺必填字段；空数组违反条数下限，同样交给上游 400 说清楚。
 * 不按题型删键：predicate 带了 choices 是调用方的错，交给上游 400 说清楚，包里不悄悄吞掉。
 */
function cleanQuestion(q: OpenAIDecisionQuestion): OpenAIDecisionQuestion {
  const out: OpenAIDecisionQuestion = { type: q.type };
  if (!isUnset(q.name)) out.name = q.name;
  if (q.instructions != null) out.instructions = q.instructions;
  if (q.choices != null) out.choices = q.choices;
  if (q.levels != null) out.levels = q.levels;
  return out;
}

/**
 * 组装 OpenAI Decisions 请求体：`{ model, input, questions }`。
 * input / questions 缺省或为空时退占位模板，保证「复制出来就能跑」（同 /v1/systemone 的 state）。
 *
 * 返回值是**发上线的 JSON 形态**（过一遍 JSON 序列化）：python / typescript 两格是把 body 原样
 * 写成 SDK 调用的字面量，嵌套对象里的 `undefined` 会被写成 `None` / `null` 发出去（上游只收
 * 字符串，直接 400），而另外五门 JSON 格会把它省掉 —— 同一份输入两种请求。先归一成 JSON 形态，
 * 七门语言和消费端真实请求看到的就是同一个对象；顺带切断与占位模板常量的引用共享。
 */
export function buildOpenAIDecisionBody(
  opts: Pick<OpenAIDecisionCodeGenOpts, 'modelId' | 'input' | 'questions'>,
): Record<string, unknown> {
  const input = isUnset(opts.input) ? OPENAI_DECISION_INPUT_PLACEHOLDER : opts.input;
  const raw = isUnset(opts.questions) ? OPENAI_DECISION_QUESTIONS_PLACEHOLDER : opts.questions!;
  return JSON.parse(JSON.stringify({ model: opts.modelId, input, questions: raw.map(cleanQuestion) }));
}

/** 组装 OpenAI Decisions 上下文（body 走 buildOpenAIDecisionBody，与真实请求同源）。 */
export function buildOpenAIDecisionCtx(opts: OpenAIDecisionCodeGenOpts): OpenAIDecisionCtx {
  return {
    baseUrl: opts.baseUrl,
    path: OPENAI_DECISION_PATH,
    bodyObj: buildOpenAIDecisionBody(opts),
  };
}
