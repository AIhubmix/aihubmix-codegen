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

/**
 * 代码协议 id → canon 协议 id。
 *
 * canon（AIHubMix 模型知识库）用带命名空间的全名标协议，包内用短 id。能力注入层的调用方
 * 要拿包给的 proto 去 canon 里查能力记录，两套 id 的换算就落在这里 —— 不然每个消费端
 * 各写一份 `chat → 'openai.chat_completions'` 的 map，改名时漏一个就静默查不到能力。
 *
 * ⚠️ 与 KIND_TO_PROTO / ENDPOINT_TO_PROTO 是**第三套**独立词表：那两套吃的是网关 schema 的
 * `endpoint.kind` 与模型库的 `mdl_info.endpoints`，这套吃的是 canon 投影的 `protocol` 字段。
 * 三个数据源三套命名是历史事实，合并会让任一方改名时静默漏协议。
 */
export const PROTO_TO_CANON: Record<CodeProto, string> = {
  chat: 'openai.chat_completions',
  responses: 'openai.responses',
  messages: 'anthropic.messages',
  gemini: 'google.gemini',
};

/** canon 协议 id → 代码协议 id（PROTO_TO_CANON 的反表，自动导出，不手写第二份）。 */
export const CANON_TO_PROTO: Record<string, CodeProto> = Object.fromEntries(
  Object.entries(PROTO_TO_CANON).map(([proto, canon]) => [canon, proto as CodeProto]),
) as Record<string, CodeProto>;

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
