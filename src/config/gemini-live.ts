/**
 * Gemini Live（原生 BidiGenerateContent WebSocket）端点事实。
 *
 * 与 OpenAI realtime（/v1/realtime）是两套线协议：握手路径、首帧形状（setup vs session.update）、
 * 音频帧形状（realtimeInput.audio vs input_audio_buffer.append）、输入采样率（16k vs 24k）都不同，
 * 故走独立入口 generateGeminiLiveCode，不复用 realtime 的 builder / 渲染器。
 *
 * 以下事实在 aihubmix.com 生产网关实测（2026-11-19，gemini-3.8-live / gemini-2.5-flash-live）：
 *   - 握手：model 必须在 query（网关 upgrade 前冻结模型，选渠道/计价都依赖它）。
 *   - responseModalities 只要 ["TEXT"] 时两个模型都被上游 1007 关会话；回复一律走 AUDIO，
 *     要文字就开 outputAudioTranscription。
 *   - 数字人（Live Avatar，仅 3.8）：responseModalities 必须恰为 ["VIDEO"] + avatarConfig.avatarName；
 *     下行是一条连续的 fragmented MP4（首帧 ftyp+moov，其后 moof+mdat，H.264 + AAC 同流，704x1280）。
 */

/** 握手路径（v1beta；网关同时接受 v1，两者同入口）。 */
export const GL_PATH = '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** 输入音频：PCM16 小端 / 单声道 / 16kHz（网关逐帧校验 mimeType，其它值整帧拒）。 */
export const GL_INPUT_RATE = 16000;
export const GL_INPUT_AUDIO_MIME = `audio/pcm;rate=${GL_INPUT_RATE}`;

/** 输出音频：PCM16 / 24kHz（3.8 标 audio/pcm;rate=24000，2.5 只标 audio/pcm，采样率同为 24k）。 */
export const GL_OUTPUT_RATE = 24000;

/** 视频输入：单帧 JPEG，官方建议 1 FPS、768x768 以内。 */
export const GL_VIDEO_MIME = 'image/jpeg';
export const GL_VIDEO_FPS = 1;
export const GL_VIDEO_MAX_EDGE = 768;

/** 数字人下行容器（MediaSource 播放用的完整 MIME + codecs，取自实测 init segment）。 */
export const GL_AVATAR_MIME = 'video/mp4; codecs="avc1.42c01f, mp4a.40.2"';

/** 实测可用的预置数字人形象（不存在的名字会被上游 1007 关会话）。 */
export const GL_AVATARS = ['Jay', 'Ben'] as const;

/** 推荐切片时长（毫秒）：官方建议 20–100ms 一片。 */
export const GL_CHUNK_MS = 100;
