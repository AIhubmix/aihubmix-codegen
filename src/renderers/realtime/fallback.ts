/**
 * Realtime 转录降级格（go/java/csharp/ruby）：完整模板未上线前给可行动的注释块，
 * 而不是静默空串或错误的 HTTP 示例（a-lite 决策：python/typescript 先行精品）。
 */
import { API_KEY_PLACEHOLDER } from '../../config/placeholders.js';
import type { RealtimeCtx } from '../../wire/realtime.js';

const LANG_NAME = { go: 'Go', java: 'Java', csharp: 'C#', ruby: 'Ruby' } as const;

export function realtimeFallback(lang: keyof typeof LANG_NAME): (ctx: RealtimeCtx) => string {
  const prefix = lang === 'ruby' ? '#' : '//';
  const name = LANG_NAME[lang];
  return (ctx) => `${prefix} Realtime transcription runs over a WebSocket session (not HTTP request/response).
${prefix} A polished ${name} sample is on the way — any WebSocket client works today:
${prefix}   URL:    ${ctx.url}
${prefix}   Header: Authorization: Bearer <${API_KEY_PLACEHOLDER} from your environment>
${prefix}   1) send a session.update frame (copy it from the Python or TypeScript tab)
${prefix}   2) stream {"type":"input_audio_buffer.append","audio":"<base64 PCM16 / 24kHz / mono>"}
${prefix}   3) send {"type":"input_audio_buffer.commit"} to finalize a segment
${prefix}   4) read ...transcription.delta / ...transcription.completed events`;
}
