/**
 * 各协议请求路径。路由是网关契约（不是消费端偏好），故住在包里 —— 数据在
 * config/protocols.ts 的 PROTO_ROUTES，这里只做 `{model}` 替换。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { PROTO_ROUTES } from '../config/protocols.js';

/** 各协议请求路径。gemini 含 model id + `:generateContent`（动态，故按 ctx）；代码侧统一出非流式端点。 */
export function endpointPath(proto: CodeProto, ctx: CodeGenCtx): string {
  const tpl = PROTO_ROUTES[proto] ?? PROTO_ROUTES.chat;
  return tpl.replace('{model}', encodeURIComponent(ctx.model.id));
}
