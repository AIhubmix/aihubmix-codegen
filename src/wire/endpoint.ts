/**
 * 各协议请求路径。
 *
 * 路由是网关契约（不是消费端偏好），故住在包里。这里先按原样保留硬编码字面量 ——
 * 下一步（config 层）会把四条路由收进 config/protocols.ts 的 pathTemplate。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';

/** 各协议请求路径。gemini 含 model id + `:generateContent`（动态，故按 ctx）；代码侧统一出非流式端点。 */
export function endpointPath(proto: CodeProto, ctx: CodeGenCtx): string {
  switch (proto) {
    case 'gemini':
      return `/gemini/v1beta/models/${encodeURIComponent(ctx.model.id)}:generateContent`;
    case 'messages':
      return '/v1/messages';
    case 'responses':
      return '/v1/responses';
    default:
      return '/v1/chat/completions';
  }
}
