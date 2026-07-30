import type { CodeProto, ProtoDef } from '../types.js';

/** 协议清单 —— 唯一真源。 */
export const PROTOCOLS: ProtoDef[] = [
  { id: 'chat', label: 'Chat Completions' },
  { id: 'messages', label: 'Messages' },
  { id: 'responses', label: 'Responses' },
  { id: 'gemini', label: 'Gemini' },
];

/** 上游 / 网关契约里的版本号常量。上游改版只动这里。 */
export const UPSTREAM = {
  /** Anthropic Messages 必带的 API 版本头值 */
  anthropicVersion: '2023-06-01',
} as const;

/**
 * 各协议请求路径模板 —— 网关契约，唯一真源。
 * `{model}` 由调用方替换成 **URL-encoded** 的模型 id（只有 gemini 用得到）。
 * 未知协议按 chat 兜底（与原 switch 的 default 分支同义）。
 */
export const PROTO_ROUTES: Record<CodeProto, string> = {
  chat: '/v1/chat/completions',
  messages: '/v1/messages',
  responses: '/v1/responses',
  gemini: '/gemini/v1beta/models/{model}:generateContent',
};

export interface AuthHeaderDef {
  name: string;
  /** 值模板；`{key}` 由调用方替换成 API key 占位（或真实变量名） */
  value: string;
}

/**
 * 各协议鉴权头 —— 唯一真源。
 *
 * 原先这套事实在 goRaw / javaRaw / csRaw / curl / rubyGemini 五个 renderer 里各写了一份
 * 三分支 ternary，`anthropic-version` 字面量出现 5 次。现在 renderer 只负责把每条头转成
 * 本语言的写法，不再决定「有哪些头、值是什么」。
 */
export const AUTH_HEADERS: Record<CodeProto, AuthHeaderDef[]> = {
  chat: [{ name: 'Authorization', value: 'Bearer {key}' }],
  responses: [{ name: 'Authorization', value: 'Bearer {key}' }],
  messages: [
    { name: 'x-api-key', value: '{key}' },
    { name: 'anthropic-version', value: UPSTREAM.anthropicVersion },
  ],
  gemini: [{ name: 'x-goog-api-key', value: '{key}' }],
};
