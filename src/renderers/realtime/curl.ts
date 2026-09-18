/**
 * Realtime 转录 curl 格：curl 无法承载双向 WS 会话，出 wscat 连通性验证 + 帧序说明。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { sessionUsesVad, type RealtimeCtx } from '../../wire/realtime.js';

export function realtimeCurl(ctx: RealtimeCtx): string {
  const sessionLine = JSON.stringify(ctx.session);
  const commitNote = sessionUsesVad(ctx)
    ? 'flush any trailing audio (server VAD auto-segments the rest on pauses):'
    : 'finalize the segment (turn_detection is null → commit manually):';
  return `# Realtime transcription is a bidirectional WebSocket session — plain curl
# cannot stream it. Quick connectivity + auth check with wscat (npm i -g wscat):
wscat -c "${ctx.url}" \\
  -H "Authorization: Bearer ${ENV_KEY_EXPR.curl}"

# After it connects, paste this session.update frame to configure the session:
# ${sessionLine}
#
# Then stream audio frames (base64 PCM16 / 24kHz / mono):
#   {"type":"input_audio_buffer.append","audio":"<BASE64_PCM16_CHUNK>"}
# and ${commitNote}
#   {"type":"input_audio_buffer.commit"}
# Transcription arrives as ...transcription.delta / ...transcription.completed events.
# For a runnable end-to-end sample, see the Python or TypeScript tab.`;
}
