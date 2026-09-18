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
  RT_CONV_SESSION_TYPE,
  RT_DEFAULT_VOICE,
  RT_INTENT,
  RT_PATH,
  RT_SAMPLE_RATE,
} from '../config/realtime.js';

/** Realtime 渲染上下文：会话类型 + 握手 URL + session.update 首帧，贯穿各语言生成函数。 */
export interface RealtimeCtx {
  /** 'transcription'（单向收字）| 'conversation'（双向收音频回放）。渲染器据此切接收循环。 */
  kind: 'transcription' | 'conversation';
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

/**
 * 握手 URL：https base → wss，query 必带 model（网关握手期硬性要求）。
 * - 转录（缺省）：`?intent=transcription&model=`——网关握手期按 intent 选路。
 * - 对话：`?model=` only，**不带 intent**——网关从不读客户端 query 的 intent，对话 kind 由
 *   网关侧 REALTIME_CONVERSATION_MODELS 名单经 DeriveSessionKind 从模型名推导，上游拨号 URL
 *   由网关自己重组；误带 intent 无害但去掉更清爽。
 */
export function realtimeWsUrl(
  baseUrl: string,
  modelId: string,
  kind: 'transcription' | 'conversation' = 'transcription',
): string {
  const wsBase = baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  const model = `model=${encodeURIComponent(modelId)}`;
  const query = kind === 'conversation' ? model : `intent=${RT_INTENT}&${model}`;
  return `${wsBase}${RT_PATH}?${query}`;
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

/**
 * 对话（conversation / speech-to-speech）的 session.update 首帧——**白名单构造**，与
 * buildRealtimeSession 彻底分开、不共用任何拼接。
 *
 * 为什么必须独立、必须白名单（由网关 1008 硬约束倒推）：
 * - 消毒器 SanitizeSessionUpdate 对任一条不合规**直接 ClosePolicyViolation 1008 关整条会话**
 *   （不是只丢那一帧）。最致命的是 `audio.input.transcription` 非 null → 1008
 *   （input_transcription_not_supported，内嵌转写=第二计费模型未接）。官方 realtime SDK 默认会
 *   给 input.transcription 配 whisper/gpt-4o-transcribe、或把上游回发的 session 原样回写，
 *   只要带上第一帧就把会话打死——故这里**从不透传上游 session、绝不拼 transcription**。
 * - `audio.input.format.rate` 必须 24000（硬校验，填别的整帧拒）；`audio.output.format.type`
 *   锁 audio/pcm（output rate 无强校验，附上 24000 描述北向播放采样率）。
 * - `audio.output.voice` 首个 response.created 后不可变，只在此首帧钉一次。
 * - `turn_detection` 在消毒白名单外=透传上游，但上游默认 VAD 因模型而异（别赌默认开），故
 *   **显式拼 server_vad**：前端靠服务端 VAD 自动起 response（不发 response.create），拼上才闭环。
 * - `instructions` 同在白名单外=透传，空则不拼。
 * 其余一律不拼（session.model 缺省放行，不主动带；modalities/其它键一律不碰）。
 */
export function buildConversationSession(opts: RealtimeCodeGenOpts): Record<string, unknown> {
  const input: Record<string, unknown> = {
    format: { type: RT_AUDIO_TYPE, rate: RT_SAMPLE_RATE },
    // 显式 server_vad：服务端按停顿自动分段并自动起 response，客户端不发 response.create。
    turn_detection: { type: 'server_vad' },
    // 刻意不含 transcription：带上=1008 关会话。
  };

  const output: Record<string, unknown> = {
    format: { type: RT_AUDIO_TYPE, rate: RT_SAMPLE_RATE },
    voice: opts.voice?.trim() || RT_DEFAULT_VOICE,
  };

  const session: Record<string, unknown> = {
    type: RT_CONV_SESSION_TYPE,
    audio: { input, output },
  };
  if (opts.instructions?.trim()) session.instructions = opts.instructions.trim();

  return { type: 'session.update', session };
}
