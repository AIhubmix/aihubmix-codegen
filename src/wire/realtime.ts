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

/** 握手 URL：https base → wss，query 必带 intent 与 model（网关握手期硬性要求）。 */
export function realtimeWsUrl(baseUrl: string, modelId: string): string {
  const wsBase = baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  return `${wsBase}${RT_PATH}?intent=${RT_INTENT}&model=${encodeURIComponent(modelId)}`;
}

/**
 * session.update 首帧载荷。
 * - transcription.model 必须与握手 URL 一致（网关越权拦截，1008 关会话）。
 * - turn_detection 恒 null：转录会话不支持 VAD，非 null 会被模型推理商 invalid_value 拒。
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
    turn_detection: null,
  };
  if (opts.noiseReduction) input.noise_reduction = { type: opts.noiseReduction };

  return {
    type: 'session.update',
    session: { type: RT_INTENT, audio: { input } },
  };
}
