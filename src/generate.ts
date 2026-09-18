/**
 * 分发层：generateCode（4 协议 × 7 语言）/ generateMediaCode（图/视频 × 7 语言）/
 * generateRealtimeCode（转录 + 对话 × 7 语言）/ generateDecisionCode（结构化决策 × 7 语言）。
 *
 * 分发逻辑全在 renderers/registry.ts 的几张表里，本文件只剩查表 + 降级。
 */
import type {
  CodeGenCtx,
  CodeLang,
  CodeProto,
  DecisionCodeGenOpts,
  MediaCodeGenOpts,
  RealtimeCodeGenOpts,
} from './types.js';
import { MEDIA_PLACEHOLDER } from './config/placeholders.js';
import {
  DECISION_RENDERERS,
  MEDIA_RENDERERS,
  REALTIME_CONV_RENDERERS,
  REALTIME_RENDERERS,
  RENDERERS,
} from './renderers/registry.js';
import { buildDecisionCtx } from './wire/decision.js';
import { buildMediaCtx, filterParams } from './wire/media.js';
import { buildConversationSession, buildRealtimeSession, realtimeWsUrl } from './wire/realtime.js';
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
 * 生成 realtime（WebSocket 双向流）请求代码。传输形态与四协议不同，独立入口
 * （照 media 先例），不进 CodeProto 词表。
 *
 * 两条 lane 由 opts.kind 分派，握手 URL 与 session.update 首帧走各自独立的
 * builder —— 消费端真实 WS 客户端必须走同一对函数（真实请求 = Get Code 同源）：
 * - transcription（缺省）：realtimeWsUrl(带 intent) + buildRealtimeSession（拼 transcription）。
 * - conversation：realtimeWsUrl(去 intent) + buildConversationSession（白名单，禁 transcription）。
 *   对话帧带 input.transcription 会被网关 1008 关整条会话，故两条 builder 绝不共用。
 */
export function generateRealtimeCode(opts: RealtimeCodeGenOpts): string {
  if (opts.kind === 'conversation') {
    const ctx = {
      kind: 'conversation' as const,
      url: realtimeWsUrl(opts.baseUrl, opts.modelId, 'conversation'),
      session: buildConversationSession(opts),
    };
    // 未知语言退 curl 格（wscat 连通性说明总可读），与另两张表的降级一致。
    return (REALTIME_CONV_RENDERERS[opts.lang] ?? REALTIME_CONV_RENDERERS.curl)(ctx);
  }
  const ctx = {
    kind: 'transcription' as const,
    url: realtimeWsUrl(opts.baseUrl, opts.modelId),
    session: buildRealtimeSession(opts),
  };
  return (REALTIME_RENDERERS[opts.lang] ?? REALTIME_RENDERERS.curl)(ctx);
}

/**
 * 生成 decision（结构化决策）请求代码：单次 POST /v1/systemone，一份 state + 一组类型化
 * questions 进去，一张 answers 表出来。独立入口（照 media / realtime 先例），不进 CodeProto 词表。
 *
 * body 走 buildDecisionBody —— 消费端发真实请求必须走同一个函数（同源缝）。
 */
export function generateDecisionCode(opts: DecisionCodeGenOpts): string {
  const ctx = buildDecisionCtx(opts);
  // 未知语言退 curl（通用 REST 总能跑），与另三张表的降级一致。
  return (DECISION_RENDERERS[opts.lang] ?? DECISION_RENDERERS.curl)(ctx);
}
