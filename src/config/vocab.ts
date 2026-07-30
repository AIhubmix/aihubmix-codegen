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
