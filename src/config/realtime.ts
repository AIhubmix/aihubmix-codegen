/**
 * Realtime（WebSocket 转录）端点事实。传输形态与四协议（单次 HTTP POST）不同，
 * 走独立入口 generateRealtimeCode（照 media 先例），不进 CodeProto 词表。
 */

/** 握手路径。model/intent 必须落在握手 URL（网关握手期选路+鉴权+预留额度，
 *  session.update 来得太晚；缺 model → 握手期 400 missing_model_parameter）。 */
export const RT_PATH = '/v1/realtime';

/** 会话意图：转录。Gemini Live 等其它 realtime 面接入时再扩为参数。 */
export const RT_INTENT = 'transcription';

/** 输入音频格式：仅 PCM16 小端 / 单声道 / 24kHz（其它格式被网关 1008 拒）。 */
export const RT_AUDIO_TYPE = 'audio/pcm';
export const RT_SAMPLE_RATE = 24000;

/** 推荐切片时长（毫秒）：100ms 一帧 append，示例与 playground 共用同一节奏。 */
export const RT_CHUNK_MS = 100;
