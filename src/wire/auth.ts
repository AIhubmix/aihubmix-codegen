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
