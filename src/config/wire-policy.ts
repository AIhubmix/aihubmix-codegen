/**
 * wire 下发策略的几张名单 —— 纯数据，改这里就改行为，不用翻 renderer。
 */

// 注：CAP_GATED_WIRE_KEYS（能力接管的 wire 键）不在这里 —— 它由 wire/capabilities.ts 的
// CAPABILITIES 表自动导出。写死在这儿会变成第二份手写清单，漏一边就会「关掉能力后残留值仍被发出」。

// 有特殊下发逻辑的数值参数（改名/互斥默认跳过/上限），不走通用数值兜底，避免重复或覆盖。
export const SPECIAL_NUM_KEYS = new Set([
  'max_tokens', 'max_completion_tokens', 'max_output_tokens',
  'temperature', 'top_p', 'top_k',
  'frequency_penalty', 'presence_penalty', 'repetition_penalty',
]);

/** SDK 调用骨架自己铺的结构性键（不进 sdkParamLines）。 */
export const STRUCT_KEYS = new Set(['model', 'messages', 'input', 'instructions', 'system', 'stream']);

/** OpenAI Python SDK 原生 kwargs 白名单；非白名单键进 extra_body（top_k/repetition_penalty 等）。 */
export const PY_OPENAI_NATIVE = new Set([
  'max_tokens', 'max_output_tokens', 'max_completion_tokens', 'temperature', 'top_p',
  'frequency_penalty', 'presence_penalty', 'n', 'seed', 'stop', 'logprobs', 'top_logprobs',
  'tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'text',
  'reasoning_effort', 'reasoning', 'verbosity', 'service_tier', 'logit_bias', 'user', 'store',
  'metadata', 'stream_options', 'modalities',
]);
