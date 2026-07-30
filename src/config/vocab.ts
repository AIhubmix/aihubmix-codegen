import type { CodeProto } from '../types.js';

/** schema endpoint.kind → 代码协议 id（协议 tab 按模型 schema 动态生成时用）。 */
export const KIND_TO_PROTO: Record<string, CodeProto> = {
  openai_chat: 'chat',
  anthropic_messages: 'messages',
  // 网关写的 responses kind 是复数 openai_responses;缺复数别名会让协议 tab 少一个。
  openai_response: 'responses',
  openai_responses: 'responses',
  // Gemini 原生 generateContent 端点。
  gemini_generate_content: 'gemini',
};

/**
 * DB `mdl_info.endpoints` 的取值 → 代码协议 id。
 *
 * 与 KIND_TO_PROTO 是**两套独立词表**，喂的数据源不同：前者吃网关 schema 的 `endpoint.kind`
 * （playground 用），后者吃模型库的 `mdl_info.endpoints` 逗号串（模型详情页用）。两边命名
 * 不一致是历史事实，不合并 —— 合并会让任一方改名时静默漏协议。
 *
 * ⚠️ 无数据就降级：`endpoints` 为空时**不猜协议**（线上 kimi-k3 就是空），由调用方决定回落。
 */
export const ENDPOINT_TO_PROTO: Record<string, CodeProto> = {
  chat_completions: 'chat',
  claude_api: 'messages',
  responses: 'responses',
  gemini_api: 'gemini',
};

/** 解析 `mdl_info.endpoints`（逗号串或数组）→ 去重后的协议列表；无法识别的项直接丢弃。 */
export function protosFromEndpoints(endpoints: string | string[] | null | undefined): CodeProto[] {
  if (!endpoints) return [];
  const items = Array.isArray(endpoints) ? endpoints : String(endpoints).split(',');
  const out: CodeProto[] = [];
  for (const raw of items) {
    const proto = ENDPOINT_TO_PROTO[raw.trim()];
    if (proto && !out.includes(proto)) out.push(proto);
  }
  return out;
}
