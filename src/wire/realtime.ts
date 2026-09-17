/**
 * Realtime 转录的 wire 层：握手 URL + session.update 载荷。
 *
 * 「Get Code == 真实请求」在 realtime 语境下的同源缝就在这两个函数：
 * playground 的真实 WS 客户端与各语言代码示例都必须经它们取 URL / 首帧配置，
 * 不允许旁路拼（与 buildBody 对四协议的地位相同）。
 */
import type { RealtimeCodeGenOpts } from '../types.js';
import {
  RT_AUDIO_TYPE,
  RT_INTENT,
  RT_PATH,
  RT_SAMPLE_RATE,
} from '../config/realtime.js';

/** Realtime 渲染上下文：握手 URL + session.update 首帧，贯穿各语言生成函数。 */
export interface RealtimeCtx {
  url: string;
  session: Record<string, unknown>;
}

/**
 * 首帧是否启用了服务端 VAD（turn_detection 非 null）。渲染器据此切「边说边分段」/「手动收段」
 * 两套注释与收尾逻辑，保证生成的示例与 session 配置自洽。
 */
export function sessionUsesVad(ctx: RealtimeCtx): boolean {
  const session = ctx.session as { session?: { audio?: { input?: { turn_detection?: unknown } } } };
  return session.session?.audio?.input?.turn_detection != null;
}

/** 握手 URL：https base → wss，query 必带 intent 与 model（网关握手期硬性要求）。 */
export function realtimeWsUrl(baseUrl: string, modelId: string): string {
  const wsBase = baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  return `${wsBase}${RT_PATH}?intent=${RT_INTENT}&model=${encodeURIComponent(modelId)}`;
}

/**
 * session.update 首帧载荷。
 * - transcription.model 必须与握手 URL 一致（网关越权拦截，1008 关会话）。
 * - turn_detection 缺省 server_vad：服务端按停顿自动分段、边说边流式吐 delta——这是网关默认
 *   （实测 session.created 即回 {type:'server_vad',…}），也是实时转录应有形态。传 turnDetection:'none'
 *   才关 VAD、走手动 commit 收段。手动 commit 在 server_vad 下也能安全冲刷尾段（实测不报 commit_empty）。
 * - languages（复数）与 language（单数）二选一；本入口只收 languages（官方推荐形态）。
 */
export function buildRealtimeSession(opts: RealtimeCodeGenOpts): Record<string, unknown> {
  const transcription: Record<string, unknown> = { model: opts.modelId };
  if (opts.languages?.length) transcription.languages = opts.languages;
  if (opts.prompt?.trim()) transcription.prompt = opts.prompt.trim();
  if (opts.keywords?.length) transcription.keywords = opts.keywords;
  if (opts.delay) transcription.delay = opts.delay;

  const input: Record<string, unknown> = {
    format: { type: RT_AUDIO_TYPE, rate: RT_SAMPLE_RATE },
    transcription,
    turn_detection: opts.turnDetection === 'none' ? null : { type: 'server_vad' },
  };
  if (opts.noiseReduction) input.noise_reduction = { type: opts.noiseReduction };

  return {
    type: 'session.update',
    session: { type: RT_INTENT, audio: { input } },
  };
}
