/**
 * Gemini Live 的 wire 层：握手 URL + setup 首帧 + 客户端输入帧。
 *
 * 「Get Code == 真实请求」在 Gemini Live 语境下的同源缝就在这几个函数：playground 的真实 WS
 * 客户端与各语言示例都必须经它们取 URL / 首帧 / 输入帧，不允许旁路拼（与 buildBody 对四协议、
 * buildConversationSession 对 OpenAI realtime 的地位相同）。
 *
 * setup 白名单（网关 SanitizeSessionUpdate 对白名单外字段直接关会话）：
 * model / generationConfig / systemInstruction / tools / realtimeInputConfig /
 * inputAudioTranscription / outputAudioTranscription / contextWindowCompression / avatarConfig。
 * 本 builder 只拼其中前端可调的子集，其余一律不碰。
 */
import type { GeminiLiveCodeGenOpts } from '../types.js';
import { GL_AVATARS, GL_INPUT_AUDIO_MIME, GL_PATH, GL_VIDEO_MIME } from '../config/gemini-live.js';

/** Gemini Live 渲染上下文：握手 URL + setup 首帧 + 示例是否附带视频帧。 */
export interface GeminiLiveCtx {
  url: string;
  setup: Record<string, unknown>;
  /** 回复形态：'audio'（语音 + 转写）| 'avatar'（数字人 fMP4 视频，音频内嵌）。 */
  output: 'audio' | 'avatar';
  /** 示例是否演示推送摄像头 JPEG 帧。 */
  video: boolean;
}

/** 握手 URL：https base → wss，query 必带 model（网关握手期硬性要求，缺 → 400 missing_model_parameter）。 */
export function geminiLiveWsUrl(baseUrl: string, modelId: string): string {
  const wsBase = baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  return `${wsBase}${GL_PATH}?model=${encodeURIComponent(modelId)}`;
}

/**
 * setup 首帧。
 * - model 写 `models/<id>`，与握手 query 同名（网关校验，不一致 → 1008 model override forbidden）。
 * - responseModalities：语音 = ["AUDIO"]；数字人 = 恰为 ["VIDEO"] + avatarConfig（混合模态网关拒）。
 *   不给 ["TEXT"]：两个模型实测都会被上游 1007 关会话，文字走 outputAudioTranscription。
 * - 转写缺省开（inputAudioTranscription / outputAudioTranscription 都是空对象开关）。
 * - avatarName 空 → GL_AVATARS[0]（网关拒空名）。
 * - voice / instructions / mediaResolution 空则不拼；maxOutputTokens 不拼（网关缺省补 2048）。
 */
export function buildGeminiLiveSetup(opts: GeminiLiveCodeGenOpts): Record<string, unknown> {
  const avatar = opts.output === 'avatar';
  const generationConfig: Record<string, unknown> = {
    responseModalities: [avatar ? 'VIDEO' : 'AUDIO'],
  };
  const voice = opts.voice?.trim();
  if (voice) {
    generationConfig.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };
  }
  if (opts.mediaResolution) generationConfig.mediaResolution = opts.mediaResolution;

  const setup: Record<string, unknown> = {
    model: `models/${opts.modelId}`,
    generationConfig,
  };
  const instructions = opts.instructions?.trim();
  if (instructions) setup.systemInstruction = { parts: [{ text: instructions }] };
  if (opts.transcripts !== false) {
    setup.inputAudioTranscription = {};
    setup.outputAudioTranscription = {};
  }
  if (avatar) setup.avatarConfig = { avatarName: opts.avatarName?.trim() || GL_AVATARS[0] };
  return { setup };
}

/** 一片麦克风音频（base64 PCM16 / 16kHz / mono）。服务端 VAD 自动分段，不需要 commit。 */
export function geminiLiveAudioFrame(b64: string): Record<string, unknown> {
  return { realtimeInput: { audio: { mimeType: GL_INPUT_AUDIO_MIME, data: b64 } } };
}

/** 一帧摄像头画面（base64 JPEG）。 */
export function geminiLiveVideoFrame(b64: string): Record<string, unknown> {
  return { realtimeInput: { video: { mimeType: GL_VIDEO_MIME, data: b64 } } };
}

/** 一段打字输入（实时会话里与语音同一通道，模型按一轮输入处理）。 */
export function geminiLiveTextFrame(text: string): Record<string, unknown> {
  return { realtimeInput: { text } };
}

/** 麦克风暂停/结束：冲刷服务端已缓存的尾段音频。 */
export function geminiLiveAudioStreamEnd(): Record<string, unknown> {
  return { realtimeInput: { audioStreamEnd: true } };
}

/** 渲染上下文（示例与真实客户端共用同一 URL / setup）。 */
export function buildGeminiLiveCtx(opts: GeminiLiveCodeGenOpts): GeminiLiveCtx {
  return {
    url: geminiLiveWsUrl(opts.baseUrl, opts.modelId),
    setup: buildGeminiLiveSetup(opts),
    output: opts.output === 'avatar' ? 'avatar' : 'audio',
    video: opts.video === true,
  };
}
