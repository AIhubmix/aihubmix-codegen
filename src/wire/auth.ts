/**
 * 鉴权头解析：config 的模板 → 具体键值对。
 *
 * config/* 只放纯数据（零逻辑、可 JSON 化），故 `{key}` 的替换住在这里。
 * 各语言 renderer 拿到键值对后自己决定怎么写成一行。
 */
import type { CodeProto } from '../types.js';
import { AUTH_HEADERS } from '../config/protocols.js';
import { API_KEY_PLACEHOLDER } from '../config/placeholders.js';

/** 该协议要带的鉴权头（值里的 `{key}` 已替换）。未知协议按 chat 兜底。 */
export function authHeaders(
  proto: CodeProto,
  keyPlaceholder: string = API_KEY_PLACEHOLDER,
): { name: string; value: string }[] {
  return (AUTH_HEADERS[proto] ?? AUTH_HEADERS.chat).map((h) => ({
    name: h.name,
    value: h.value.replace('{key}', keyPlaceholder),
  }));
}

/**
 * 头的值写成「字符串字面量 + 取环境变量表达式」的拼接（key 不出字面量）。
 *
 * java / C# / go 的字符串拼接语法恰好同形（`"pre" + expr + "post"`），三家共用；
 * ruby 走插值不走这里。首尾的空串段（`"" + ` / ` + ""`）在这里收干净 ——
 * 一是难看，二是会踩「java 代码里不该出现紧贴单词的 `""`」那条转义塌陷检测。
 *
 * `"Bearer {key}"` → `"Bearer " + System.getenv("…")`；`"{key}"` → `System.getenv("…")`；
 * 不含 key 的固定值（如 anthropic-version）→ 原样字符串字面量。
 */
export function headerValueConcat(value: string, keyExpr: string): string {
  const parts = value.split(API_KEY_PLACEHOLDER);
  if (parts.length === 1) return `"${value}"`;
  return parts
    .map((p) => `"${p}"`)
    .join(` + ${keyExpr} + `)
    .replace(/^"" \+ /, '')
    .replace(/ \+ ""$/, '');
}
