/**
 * 测试共用的固定 ctx。全部字面量：无随机、无时间、无网络 —— 断言必须是确定性的。
 * 与 scripts/snapshot.mjs 的基线输入同源（同一组模型/参数/工具），两边对得上。
 */
import type { CodeGenCtx, StructuredCfg, ToolDef } from '../src/types.js';

export const BASE = 'https://aihubmix.com';
export const MODEL = 'claude-opus-5';

export const TOOLS: ToolDef[] = [
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: JSON.stringify({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    }),
  },
];

export const STRUCTURED: StructuredCfg = {
  format: 'json_schema',
  name: 'answer',
  schema: JSON.stringify({
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  }),
};

/** 全量 paramKeys：让 schema 门控放行所有参数，最大化 buildBody 的分支覆盖。 */
export const PARAM_KEYS = [
  'max_tokens', 'max_completion_tokens', 'max_output_tokens',
  'temperature', 'top_p', 'top_k',
  'frequency_penalty', 'presence_penalty', 'repetition_penalty',
  'seed', 'n', 'top_logprobs', 'logprobs',
  'verbosity', 'service_tier', 'reasoning_effort',
  'logit_bias', 'stop', 'metadata', 'parallel_tool_calls',
  'text', 'reasoning', 'thinking',
];

export const baseCtx: CodeGenCtx = {
  baseUrl: BASE,
  model: { id: MODEL },
  sys: 'You are a concise assistant.',
  user: 'Summarize the differences between the four protocols.',
  p: {
    max_tokens: 1024,
    temperature: 0.7,
    top_p: 0.9,
  },
  stream: false,
  paramKeys: PARAM_KEYS,
};

export function ctxWith(patch: Partial<CodeGenCtx>): CodeGenCtx {
  return { ...baseCtx, ...patch };
}
