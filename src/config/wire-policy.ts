/**
 * wire 下发策略的几张名单 —— 纯数据，改这里就改行为，不用翻 renderer。
 */

// 能力接管字段：text/reasoning/thinking 由输出/思考能力接管（对象，带默认+并入 format/effort/
// budget_tokens），parallel_tool_calls 由 tools 接管（布尔，随 tools 一起下发）——都不走通用
// emitObjects（那样不受能力开关门控，关掉能力后残留值仍会被发出），改由 buildBody 对应协议的能力门控块下发。
export const CAP_GATED_WIRE_KEYS = new Set(['text', 'reasoning', 'thinking', 'parallel_tool_calls']);

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
