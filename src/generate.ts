/**
 * 分发层：generateCode（4 协议 × 7 语言）/ generateMediaCode（图/视频 × 7 语言）。
 *
 * 分发逻辑全在 renderers/registry.ts 的两张表里，本文件只剩查表 + 降级。
 */
import type { CodeGenCtx, CodeLang, CodeProto, MediaCodeGenOpts, RealtimeCodeGenOpts } from './types.js';
import { MEDIA_PLACEHOLDER } from './config/placeholders.js';
import { MEDIA_RENDERERS, REALTIME_RENDERERS, RENDERERS } from './renderers/registry.js';
import { buildMediaCtx, filterParams } from './wire/media.js';
import { buildRealtimeSession, realtimeWsUrl } from './wire/realtime.js';
import { curl } from './renderers/curl.js';

export function generateCode(proto: CodeProto, lang: CodeLang, ctx: CodeGenCtx): string {
  const entry = RENDERERS[lang];
  // 未知语言：gemini 退 curl（通用 REST 总能跑），其余协议返回空串 —— 与查表化之前的降级一致。
  if (!entry) return proto === 'gemini' ? curl(proto, ctx) : '';
  return (entry[proto] ?? entry.default)(proto, ctx);
}

/**
 * 生成媒体（文生图 / 文生视频）请求代码（统一 Task 对象，见 docs endpoints-discovery）。
 * 图：单段 POST /ai/v1/images/generations（sync 阻塞，结果在 output[]）。
 * 视频：提交 POST /ai/v1/videos + 轮询 GET /ai/v1/videos/{id} + 下载 content_url 三段。
 */
export function generateMediaCode(opts: MediaCodeGenOpts): string {
  const { modality, lang } = opts;
  const prompt = opts.prompt.trim() || MEDIA_PLACEHOLDER;
  const params = filterParams(opts.params);
  const ctx = buildMediaCtx(opts, prompt, params);

  const byLang = MEDIA_RENDERERS[modality];
  // 未知语言退 curl（通用 REST），与查表化之前的降级一致。
  return (byLang[lang] ?? byLang.curl)(ctx);
}

/**
 * 生成 realtime 转录（WebSocket 双向流）请求代码。传输形态与四协议不同，独立入口
 * （照 media 先例），不进 CodeProto 词表。握手 URL 与 session.update 首帧分别由
 * realtimeWsUrl / buildRealtimeSession 产出 —— 消费端真实 WS 客户端必须走同两个函数。
 */
export function generateRealtimeCode(opts: RealtimeCodeGenOpts): string {
  const ctx = {
    url: realtimeWsUrl(opts.baseUrl, opts.modelId),
    session: buildRealtimeSession(opts),
  };
  // 未知语言退 curl 格（wscat 连通性说明总可读），与另两张表的降级一致。
  return (REALTIME_RENDERERS[opts.lang] ?? REALTIME_RENDERERS.curl)(ctx);
}
